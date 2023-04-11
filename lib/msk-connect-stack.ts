import { CfnOutput, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";

import { Bucket } from "aws-cdk-lib/aws-s3";
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { CfnConnector } from "aws-cdk-lib/aws-kafkaconnect";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Vpc } from "aws-cdk-lib/aws-ec2";
// import { Cluster } from "@aws-cdk/aws-msk-alpha";

const PLUGIN_BUCKET = "msk-connect-plugin-bucket";
const PLUGIN_FILE = "confluentinc-kafka-connect-s3-10.4.2.zip";

export class MskConnectStack extends Stack {
  props: StackProps;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);
    this.props = props;
    this.build();
  }

  build() {
    const sinkBucket = new Bucket(this, "SinkBucket", {
      versioned: false,
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const kafkaConnectS3SinkConfig = {
      "connector.class": "io.confluent.connect.s3.S3SinkConnector",
      "tasks.max": "1",
      topics: "nicks_topic", // Replace with your Kafka topic
      "s3.region": this.region,
      "s3.bucket.name": sinkBucket.bucketName,
      "flush.size": "1",
      "storage.class": "io.confluent.connect.s3.storage.S3Storage",
      "format.class": "io.confluent.connect.s3.format.json.JsonFormat",
      "partitioner.class":
        "io.confluent.connect.storage.partitioner.DefaultPartitioner",
    };

    // const plugin = new AwsCustomResource(this, "msk-connect-plugin", {
    //   policy: AwsCustomResourcePolicy.fromStatements([
    //     new PolicyStatement({
    //       effect: Effect.ALLOW,
    //       actions: ["s3:GetObject"],
    //       resources: [`arn:aws:s3:::${PLUGIN_BUCKET}/*`],
    //     }),
    //     new PolicyStatement({
    //       effect: Effect.ALLOW,
    //       actions: [
    //         "kafkaconnect:CreateCustomPlugin",
    //         "kafkaconnect:DeleteCustomPlugin",
    //       ],
    //       resources: ["*"],
    //     }),
    //   ]),
    //   onUpdate: {
    //     service: "KafkaConnect",
    //     action: "createCustomPlugin",
    //     physicalResourceId: PhysicalResourceId.of("customConnectorPlugin"),
    //     parameters: {
    //       contentType: "ZIP",
    //       location: {
    //         s3Location: {
    //           bucketArn: `arn:aws:s3:::${PLUGIN_BUCKET}`,
    //           fileKey: PLUGIN_FILE,
    //         },
    //       },
    //       name: "kafka-connect-connector-plugin",
    //       description: "connector plugin",
    //     },
    //   },
    //   onCreate: {
    //     service: "KafkaConnect",
    //     action: "createCustomPlugin",
    //     physicalResourceId: PhysicalResourceId.of("customConnectorPlugin"),
    //     parameters: {
    //       contentType: "ZIP",
    //       location: {
    //         s3Location: {
    //           bucketArn: `arn:aws:s3:::${PLUGIN_BUCKET}`,
    //           fileKey: PLUGIN_FILE,
    //         },
    //       },
    //       name: "kafka-connect-connector-plugin",
    //       description: "connector plugin",
    //     },
    //   },
    // });

    // new AwsCustomResource(this, "msk-connect-plugin-delete", {
    //   policy: AwsCustomResourcePolicy.fromStatements([
    //     new PolicyStatement({
    //       effect: Effect.ALLOW,
    //       actions: ["kafkaconnect:DeleteCustomPlugin"],
    //       resources: ["*"],
    //     }),
    //   ]),
    //   onDelete: {
    //     service: "KafkaConnect",
    //     action: "deleteCustomPlugin",
    //     parameters: {
    //       customPluginArn: plugin
    //         .getResponseFieldReference("customPluginArn")
    //         .toString(),
    //     },
    //   },
    // });

    // new CfnOutput(this, "custom-plugin-arn", {
    //   value: plugin.getResponseFieldReference("customPluginArn").toString(),
    // });

    const boostrapParam = StringParameter.fromStringParameterName(
      this,
      "msk-brokers-from-param",
      "/msk/bootstrap-brokers"
    );

    const vpc = Vpc.fromLookup(this, "msk-vpc-lookup", {
      vpcName: "msk-vpc",
    });

    // const arnParam = StringParameter.fromStringParameterName(
    //   this,
    //   "msk-cluster-arn-from-param",
    //   "/msk/cluster-arn"
    // );

    // const mskCluster = Cluster.fromClusterArn(
    //   this,
    //   "msk-cluster",
    //   arnParam.stringValue
    // );

    // const sg = new SecurityGroup(this, "msk-connect-sg", {
    //   vpc,
    //   description: "Allow msk connector traffic",
    //   allowAllOutbound: true,
    // });
    // mskCluster.connections.securityGroups.forEach((csg) => {
    //   sg.connections.allowFrom(csg, Port.allTraffic());
    // });

    const mskConnectRole = new Role(this, "MskConnectRole", {
      assumedBy: new ServicePrincipal("kafkaconnect.amazonaws.com"),
    });
    sinkBucket.grantWrite(mskConnectRole);
    mskConnectRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "kafkaconnect:*",
          "ec2:CreateNetworkInterface",
          "ec2:DescribeSubnets",
          "ec2:DescribeVpcs",
          "ec2:DescribeSecurityGroups",
          "ec2:CreateTags",
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      })
    );
    mskConnectRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: [
          "ec2:DescribeNetworkInterfaces",
          "ec2:CreateNetworkInterfacePermission",
          "ec2:AttachNetworkInterface",
          "ec2:DetachNetworkInterface",
          "ec2:DeleteNetworkInterface",
        ],
        resources: ["arn:aws:ec2:*:*:network-interface/*"],
        conditions: {
          StringEquals: {
            "ec2:ResourceTag/AmazonMSKConnectManaged": "true",
          },
        },
      })
    );

    const mskConnect = new CfnConnector(this, "MskConnector", {
      connectorConfiguration: kafkaConnectS3SinkConfig,
      connectorName: "s3SinkConnector",
      kafkaCluster: {
        apacheKafkaCluster: {
          bootstrapServers: boostrapParam.stringValue,
          vpc: {
            // securityGroups: [sg.securityGroupId],
            securityGroups: ["sg-04feba986ef8f22eb"], // TODO: get from param or something, cluster sg
            subnets: vpc.privateSubnets.map((s) => s.subnetId),
          },
        },
      },
      capacity: {
        autoScaling: {
          maxWorkerCount: 1,
          mcuCount: 2,
          minWorkerCount: 1,
          scaleInPolicy: {
            cpuUtilizationPercentage: 50,
          },
          scaleOutPolicy: {
            cpuUtilizationPercentage: 80,
          },
        },
      },
      kafkaClusterClientAuthentication: {
        authenticationType: "NONE",
      },
      kafkaClusterEncryptionInTransit: {
        encryptionType: "PLAINTEXT",
      },
      kafkaConnectVersion: "2.7.1",
      plugins: [
        {
          customPlugin: {
            customPluginArn:
              "arn:aws:kafkaconnect:us-east-1:270744187218:custom-plugin/kafka-connect-connector-plugin/8b4fed71-6f16-4f53-a2c0-113f53dce173-2",
            revision: 1,
          },
        },
      ],
      serviceExecutionRoleArn: mskConnectRole.roleArn,
      // logDelivery: {
      //   workerLogDelivery: {
      //     cloudWatchLogs: {
      //       enabled: true,
      //       logGroup: new LogGroup(this, "msk-connect-LogGroup", {
      //         removalPolicy: RemovalPolicy.DESTROY,
      //       }).logGroupName,
      //     },
      //   },
      // },
    });

    mskConnect.node.addDependency(sinkBucket);
  }
}
