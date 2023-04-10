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
  Effect,
  ManagedPolicy,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import * as fs from "fs";
import { Cluster, KafkaVersion } from "@aws-cdk/aws-msk-alpha";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { CfnConnector } from "aws-cdk-lib/aws-kafkaconnect";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { LogGroup } from "aws-cdk-lib/aws-logs";

const PLUGIN_BUCKET = "msk-connect-plugin-bucket";
const PLUGIN_FILE = "confluentinc-kafka-connect-s3-10.4.2";

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

    new CfnOutput(this, "msk-brokers", {
      value: mskCluster.bootstrapBrokersTls,
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

    const sinkBucket = new Bucket(this, "SinkBucket", {
      versioned: false,
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

    const mskConnect = new CfnConnector(this, "MskConnector", {
      connectorConfiguration: kafkaConnectS3SinkConfig,
      connectorName: "S3-sink-connector",
      kafkaCluster: {
        apacheKafkaCluster: {
          bootstrapServers: mskCluster.bootstrapBrokersTls,
          vpc: {
            securityGroups: [],
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
            logGroup: new LogGroup(this, "msk-connect-LogGroup", {})
              .logGroupName,
          },
        },
      },
    });

    sinkBucket.node.addDependency(mskCluster);
    mskConnect.node.addDependency(sinkBucket);
  }
}
