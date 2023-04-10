import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import {
  Vpc,
  Instance,
  InstanceType,
  InstanceSize,
  InstanceClass,
  SecurityGroup,
  MachineImage,
  AmazonLinuxGeneration,
  SubnetType,
  Peer,
  Port,
} from "aws-cdk-lib/aws-ec2";
import {
  ManagedPolicy,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import * as fs from "fs";
import { Cluster, KafkaVersion } from "@aws-cdk/aws-msk-alpha";
import { StringParameter } from "aws-cdk-lib/aws-ssm";

export class MskStack extends Stack {
  props: StackProps;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    this.props = props;
    this.build();
  }

  build() {
    const vpc = new Vpc(this, "msk-vpc", {
      maxAzs: 2,
      vpcName: "msk-vpc",
    });

    const mskCluster = new Cluster(this, "msk-cluster", {
      clusterName: "msk-cluster",
      kafkaVersion: KafkaVersion.V2_8_1,
      numberOfBrokerNodes: 2,
      vpc,
      instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.SMALL),
      removalPolicy: RemovalPolicy.DESTROY,
    });

    mskCluster.connections.allowFrom(
      Peer.ipv4(vpc.vpcCidrBlock),
      Port.tcp(9094),
      "Allow connections from vpc"
    );

    new CfnOutput(this, "msk-brokers-out", {
      value: mskCluster.bootstrapBrokersTls,
    });

    new StringParameter(this, "msk-brokers-ssm", {
      stringValue: mskCluster.bootstrapBrokersTls,
      parameterName: "/msk/bootstrap-brokers",
    });

    const instanceSG = new SecurityGroup(this, "instance-sg", {
      vpc,
      description: "Allow traffic for session manager",
      allowAllOutbound: true,
    });

    const instanceRole = new Role(this, "instance-role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });
    instanceRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    // instance for session manager
    const privateInstance = new Instance(this, "private-instance", {
      vpc,
      instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
      machineImage: MachineImage.latestAmazonLinux({
        generation: AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpcSubnets: {
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      },
      securityGroup: instanceSG,
      role: instanceRole,
    });
    privateInstance.addUserData(fs.readFileSync("lib/user_data.sh", "utf-8"));
  }
}
