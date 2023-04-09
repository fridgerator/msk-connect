#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { MskConnectStack } from "../lib/msk-connect-stack";

const app = new cdk.App();
new MskConnectStack(app, "MskConnectStack", {
  env: {
    region: process.env.AWS_REGION,
    account: process.env.AWS_ACCOUNT,
  },
});
