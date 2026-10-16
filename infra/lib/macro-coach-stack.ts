import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { HttpApi, HttpMethod, CorsHttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Rule, Schedule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction, OutputFormat, type NodejsFunctionProps } from "aws-cdk-lib/aws-lambda-nodejs";
import { RetentionDays } from "aws-cdk-lib/aws-logs";
import { BlockPublicAccess, Bucket } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { Distribution, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Trigger } from "aws-cdk-lib/triggers";
import { existsSync } from "node:fs";
import type { Construct } from "constructs";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = path.join(here, "..", "..", "server", "src");
const simulatorDist = path.join(here, "..", "..", "simulator", "dist");

export interface MacroCoachStackProps extends StackProps {
  fdcApiKey: string;
  demoToken: string;
  bedrockModelId: string;
}

export class MacroCoachStack extends Stack {
  constructor(scope: Construct, id: string, props: MacroCoachStackProps) {
    super(scope, id, props);

    const table = new Table(this, "Table", {
      partitionKey: { name: "PK", type: AttributeType.STRING },
      sortKey: { name: "SK", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    table.addGlobalSecondaryIndex({
      indexName: "GSI1",
      partitionKey: { name: "GSI1PK", type: AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: AttributeType.STRING },
    });

    const common: NodejsFunctionProps = {
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 1024,
      logRetention: RetentionDays.ONE_MONTH,
      environment: {
        TABLE_NAME: table.tableName,
        FDC_API_KEY: props.fdcApiKey,
        BEDROCK_MODEL_ID: props.bedrockModelId,
        DEMO_TOKEN: props.demoToken,
        NODE_OPTIONS: "--enable-source-maps",
      },
      bundling: {
        format: OutputFormat.ESM,
        target: "node22",
        sourceMap: true,
        mainFields: ["module", "main"],
        // Bundle the AWS SDK too, so the deployed code matches the versions we test with.
        externalModules: [],
        // Express and some AWS SDK internals still call require(); provide it in the ESM bundle.
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
      },
    };

    const api = new NodejsFunction(this, "McpFunction", {
      ...common,
      entry: path.join(serverSrc, "lambda.ts"),
      handler: "handler",
      timeout: Duration.seconds(29),
      description: "Macro Coach MCP server (Streamable HTTP, stateless)",
    });
    table.grantReadWriteData(api);
    api.addToRolePolicy(
      new PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: ["arn:aws:bedrock:*::foundation-model/*", `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
      }),
    );

    const httpApi = new HttpApi(this, "HttpApi", {
      description: "Macro Coach public endpoint",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST, CorsHttpMethod.DELETE, CorsHttpMethod.OPTIONS],
        allowHeaders: ["authorization", "content-type", "mcp-protocol-version", "mcp-session-id", "last-event-id"],
        exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
      },
    });
    const integration = new HttpLambdaIntegration("McpIntegration", api);
    httpApi.addRoutes({ path: "/mcp", methods: [HttpMethod.GET, HttpMethod.POST, HttpMethod.DELETE], integration });
    httpApi.addRoutes({ path: "/health", methods: [HttpMethod.GET], integration });
    httpApi.addRoutes({ path: "/agent/converse", methods: [HttpMethod.POST], integration });

    // Seed the judge user on every deploy, then refresh nightly so the demo week stays current.
    const seed = new NodejsFunction(this, "SeedFunction", {
      ...common,
      entry: path.join(serverSrc, "seedHandler.ts"),
      handler: "handler",
      timeout: Duration.minutes(2),
      description: "Seeds the Macro Coach judge demo user",
    });
    table.grantReadWriteData(seed);
    new Trigger(this, "SeedOnDeploy", { handler: seed, executeAfter: [table], executeOnHandlerChange: true });
    new Rule(this, "NightlySeed", { schedule: Schedule.cron({ minute: "0", hour: "10" }), targets: [new LambdaFunction(seed)] });

    new CfnOutput(this, "McpUrl", { value: `${httpApi.apiEndpoint}/mcp` });
    new CfnOutput(this, "HealthUrl", { value: `${httpApi.apiEndpoint}/health` });
    new CfnOutput(this, "TableName", { value: table.tableName });

    // Static hosting for the simulator, deployed only when it has been built.
    if (existsSync(simulatorDist)) {
      const bucket = new Bucket(this, "SimulatorBucket", {
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      });
      const cdn = new Distribution(this, "SimulatorCdn", {
        defaultBehavior: { origin: S3BucketOrigin.withOriginAccessControl(bucket), viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS },
        defaultRootObject: "index.html",
      });
      new BucketDeployment(this, "SimulatorDeploy", {
        destinationBucket: bucket,
        distribution: cdn,
        sources: [
          Source.asset(simulatorDist),
          Source.jsonData("config.json", { mcpUrl: `${httpApi.apiEndpoint}/mcp`, apiBase: httpApi.apiEndpoint }),
        ],
      });
      new CfnOutput(this, "SimulatorUrl", { value: `https://${cdn.distributionDomainName}` });
    }
  }
}
