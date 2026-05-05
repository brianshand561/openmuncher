import { describe, it, expect } from 'vitest';
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { OpenMuncherStack } from '../lib/openmuncher-stack.js';

describe('OpenMuncherStack', () => {
  const app = new App();
  const stack = new OpenMuncherStack(app, 'TestStack');
  const template = Template.fromStack(stack);

  it('declares a single DynamoDB table', () => {
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
  });

  it('declares two Lambda functions', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2);
  });

  it('declares two Lambda function URLs', () => {
    template.resourceCountIs('AWS::Lambda::Url', 2);
  });

  it('declares a CloudFront distribution', () => {
    template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('attaches the WAF to the CloudFront distribution', () => {
    template.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: {
        WebACLId: { 'Fn::GetAtt': ['WebAcl', 'Arn'] },
      },
    });
  });

  it('declares a WAF Web ACL with CloudFront scope', () => {
    template.hasResourceProperties('AWS::WAFv2::WebACL', { Scope: 'CLOUDFRONT' });
  });

  it('declares an HMAC secret', () => {
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
  });

  it('outputs the CloudFront domain', () => {
    template.hasOutput('ApiDomain', {});
  });
});
