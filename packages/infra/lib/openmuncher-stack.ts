import {
  Stack,
  StackProps,
  RemovalPolicy,
  CfnOutput,
  Duration,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import {
  AttributeType,
  BillingMode,
  Table,
  ProjectionType,
} from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime, FunctionUrlAuthType, FunctionUrl } from 'aws-cdk-lib/aws-lambda';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import {
  Distribution,
  AllowedMethods,
  CachePolicy,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
  CachedMethods,
} from 'aws-cdk-lib/aws-cloudfront';
import { FunctionUrlOrigin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { CfnWebACL } from 'aws-cdk-lib/aws-wafv2';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TABLE_NAME, TOP_USERS_INDEX } from './keys.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class OpenMuncherStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // ========== DynamoDB ==========
    const table = new Table(this, 'Table', {
      tableName: TABLE_NAME,
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      sortKey: { name: 'sk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    });
    table.addGlobalSecondaryIndex({
      indexName: TOP_USERS_INDEX,
      partitionKey: { name: 'gsiPk', type: AttributeType.STRING },
      sortKey: { name: 'leaderboardTokens', type: AttributeType.NUMBER },
      projectionType: ProjectionType.ALL,
    });

    // ========== HMAC secret ==========
    const hmacSecret = new Secret(this, 'HmacSecret', {
      secretName: 'openmuncher/hmac',
      description: 'HMAC key shared between CLI and ingest Lambda',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        includeSpace: false,
      },
    });

    // ========== Lambdas ==========
    const lambdaCommonProps = {
      runtime: Runtime.NODEJS_20_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      bundling: {
        externalModules: ['@aws-sdk/*'],
        target: 'node20',
        format: 'esm' as const,
        mainFields: ['module', 'main'],
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    };

    const ingestFn = new NodejsFunction(this, 'IngestFn', {
      ...lambdaCommonProps,
      entry: join(__dirname, '../lambda/ingest/index.ts'),
      handler: 'handler',
      environment: {
        TABLE_NAME,
        HMAC_SECRET_ARN: hmacSecret.secretArn,
      },
    });
    hmacSecret.grantRead(ingestFn);
    table.grantReadWriteData(ingestFn);

    const leaderboardFn = new NodejsFunction(this, 'LeaderboardFn', {
      ...lambdaCommonProps,
      entry: join(__dirname, '../lambda/leaderboard/index.ts'),
      handler: 'handler',
      environment: { TABLE_NAME },
    });
    table.grantReadData(leaderboardFn);

    // ========== Function URLs ==========
    const ingestUrl = new FunctionUrl(this, 'IngestFnUrl', {
      function: ingestFn,
      authType: FunctionUrlAuthType.NONE,
    });
    const leaderboardUrl = new FunctionUrl(this, 'LeaderboardFnUrl', {
      function: leaderboardFn,
      authType: FunctionUrlAuthType.NONE,
    });

    // ========== WAF Web ACL ==========
    const webAcl = new CfnWebACL(this, 'WebAcl', {
      defaultAction: { allow: {} },
      scope: 'CLOUDFRONT',
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: 'OpenMuncherWebAcl',
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: 'AWSManagedCommon',
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesCommonRuleSet' },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedCommon',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'AWSManagedKnownBad',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: { vendorName: 'AWS', name: 'AWSManagedRulesKnownBadInputsRuleSet' },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'AWSManagedKnownBad',
            sampledRequestsEnabled: true,
          },
        },
        {
          name: 'RateLimit',
          priority: 2,
          action: { block: {} },
          statement: {
            rateBasedStatement: {
              limit: 2000,
              aggregateKeyType: 'IP',
            },
          },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: 'RateLimit',
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    // ========== CloudFront ==========
    const distribution = new Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new FunctionUrlOrigin(leaderboardUrl),
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachedMethods: CachedMethods.CACHE_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      additionalBehaviors: {
        '/munch': {
          origin: new FunctionUrlOrigin(ingestUrl),
          allowedMethods: AllowedMethods.ALLOW_ALL,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: CachePolicy.CACHING_DISABLED,
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
      webAclId: webAcl.attrArn,
      comment: 'OpenMuncher API edge',
    });

    // ========== Outputs ==========
    new CfnOutput(this, 'ApiDomain', { value: distribution.distributionDomainName });
    new CfnOutput(this, 'IngestUrl', { value: ingestUrl.url });
    new CfnOutput(this, 'LeaderboardUrlOut', { value: leaderboardUrl.url });
    new CfnOutput(this, 'HmacSecretArn', { value: hmacSecret.secretArn });
  }
}
