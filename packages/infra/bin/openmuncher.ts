#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { OpenMuncherStack } from '../lib/openmuncher-stack.js';

const app = new App();
new OpenMuncherStack(app, 'OpenMuncherStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
  },
});
