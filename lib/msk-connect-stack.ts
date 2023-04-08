import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import { CfnCluster } from "aws-cdk-lib/aws-msk";
import { Vpc } from "aws-cdk-lib/aws-ec2";

export class MskConnectStack extends Stack {
  props: StackProps;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    this.props = props;
    this.build();
  }

  build() {
    const vpc = new Vpc(this, "msk-vpc", {
      maxAzs: 2,
    });
    vpc.privateSubnets[0].subnetId;

    const mskCluster = new CfnCluster(this, "msk-cluster", {
      clusterName: "msk-cluster",
      kafkaVersion: "2.8.0",
      numberOfBrokerNodes: 2,
      brokerNodeGroupInfo: {
        instanceType: "kafka.t3.small",
        clientSubnets: vpc.privateSubnets.map((s) => s.subnetId),
      },
    });
  }
}
