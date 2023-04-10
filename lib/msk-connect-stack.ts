import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
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
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { SecurityGroup, Vpc } from "aws-cdk-lib/aws-ec2";

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

    const mskConnectRole = new Role(this, "MskConnectRole", {
      assumedBy: new ServicePrincipal("connect.amazonaws.com"),
    });
    sinkBucket.grantReadWrite(mskConnectRole);

    const kafkaConnectS3SinkConfig = {
      "connector.class": "io.confluent.connect.s3.S3SinkConnector",
      "tasks.max": "1",
      topics: "nicks_topic", // Replace with your Kafka topic
      "s3.region": this.region,
      "s3.bucket.name": sinkBucket.bucketName,
      "s3.part.size": "5242880",
      "flush.size": "10000",
      "storage.class": "io.confluent.connect.s3.storage.S3Storage",
      "format.class": "io.confluent.connect.s3.format.json.JsonFormat",
      "schema.generator.class":
        "io.confluent.connect.storage.hive.schema.DefaultSchemaGenerator",
      "partitioner.class":
        "io.confluent.connect.storage.partitioner.DefaultPartitioner",
    };

    const plugin = new AwsCustomResource(this, "msk-connect-plugin", {
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["s3:GetObject"],
          resources: [`arn:aws:s3:::${PLUGIN_BUCKET}/*`],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ["kafkaconnect:CreateCustomPlugin"],
          resources: ["*"],
        }),
      ]),
      onUpdate: {
        service: "KafkaConnect",
        action: "createCustomPlugin",
        physicalResourceId: PhysicalResourceId.of("customConnectorPlugin"),
        parameters: {
          contentType: "ZIP",
          location: {
            s3Location: {
              bucketArn: `arn:aws:s3:::${PLUGIN_BUCKET}`,
              fileKey: PLUGIN_FILE,
            },
          },
          name: "kafka-connect-connector-plugin",
          description: "connector plugin",
        },
      },
      onCreate: {
        service: "KafkaConnect",
        action: "createCustomPlugin",
        physicalResourceId: PhysicalResourceId.of("customConnectorPlugin"),
        parameters: {
          contentType: "ZIP",
          location: {
            s3Location: {
              bucketArn: `arn:aws:s3:::${PLUGIN_BUCKET}`,
              fileKey: PLUGIN_FILE,
            },
          },
          name: "kafka-connect-connector-plugin",
          description: "connector plugin",
        },
      },
    });

    const boostrapParam = StringParameter.fromStringParameterName(
      this,
      "msk-brokers-from-param",
      "/msk/bootstrap-brokers"
    );

    const vpc = Vpc.fromLookup(this, "msk-vpc-lookup", {
      vpcName: "msk-vpc",
    });

    const sg = new SecurityGroup(this, "msk-connect-sg", {
      vpc,
      description: "Allow msk connector traffic",
      allowAllOutbound: true,
    });

    const mskConnect = new CfnConnector(this, "MskConnector", {
      connectorConfiguration: kafkaConnectS3SinkConfig,
      connectorName: "S3-sink-connector",
      kafkaCluster: {
        apacheKafkaCluster: {
          bootstrapServers: boostrapParam.stringValue,
          vpc: {
            securityGroups: [sg.securityGroupId],
            subnets: vpc.privateSubnets.map((s) => s.subnetId),
          },
        },
      },
      capacity: {
        autoScaling: {
          maxWorkerCount: 1,
          mcuCount: 1,
          minWorkerCount: 1,
          scaleInPolicy: {
            cpuUtilizationPercentage: 90,
          },
          scaleOutPolicy: {
            cpuUtilizationPercentage: 50,
          },
        },
      },
      kafkaClusterClientAuthentication: {
        authenticationType: "NONE",
      },
      kafkaClusterEncryptionInTransit: {
        encryptionType: "TLS",
      },
      kafkaConnectVersion: "2.8.0",
      plugins: [
        {
          customPlugin: {
            customPluginArn: plugin
              .getResponseFieldReference("customPluginArn")
              .toString(),
            revision: 1,
          },
        },
      ],
      serviceExecutionRoleArn: mskConnectRole.roleArn,
      logDelivery: {
        workerLogDelivery: {
          cloudWatchLogs: {
            enabled: true,
            logGroup: new LogGroup(this, "msk-connect-LogGroup", {
              removalPolicy: RemovalPolicy.DESTROY,
            }).logGroupName,
          },
        },
      },
    });

    mskConnect.node.addDependency(sinkBucket);
  }
}
