import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

const azCount = 3;

const vpc = new awsx.ec2.Vpc("temporal-benchmark", {
    numberOfAvailabilityZones: azCount
});

const rdsSubnetGroup = new aws.rds.SubnetGroup("temporal-benchmark-rds", {
    subnetIds: vpc.privateSubnetIds
});

export const VpcId = vpc.vpcId;
export const AvailabilityZones = vpc.privateSubnetIds.apply(ids => {
    return pulumi.all(ids.map(id => aws.ec2.getSubnet({id}))).apply(subnets => {
        return subnets.map(s => s.availabilityZone);
    });
});
export const PrivateSubnetIds = vpc.privateSubnetIds;
export const PublicSubnetIds = vpc.publicSubnetIds;
export const RdsSubnetGroupName = rdsSubnetGroup.name;
export const Role = "BenchmarkClusterAdmin";

const prometheus = new aws.amp.Workspace("prometheus")
export const prometheusEndpoint = prometheus.prometheusEndpoint;

const workspaceRole = new aws.iam.Role(
    "workspaceRole",
    {
        assumeRolePolicy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Sid: "",
                Principal: {
                    Service: "grafana.amazonaws.com",
                },
            }],
        })
    }
);

const prometheusPolicy = new aws.iam.Policy("prometheusPolicy", {
    description: "Allow Grafana to access the workspace",
    policy: JSON.stringify({
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": [
                    "aps:ListWorkspaces",
                    "aps:DescribeWorkspace",
                    "aps:QueryMetrics",
                    "aps:GetLabels",
                    "aps:GetSeries",
                    "aps:GetMetricMetadata"
                ],
                "Resource": "*"
            }
        ]
    })
});

new aws.iam.RolePolicyAttachment("grafana-prometheus-policy", {
    role: workspaceRole.name,
    policyArn: prometheusPolicy.arn,
});

new aws.iam.RolePolicyAttachment("grafana-cloudwatch-policy", {
    role: workspaceRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonGrafanaCloudWatchAccess",
});

const grafana = new aws.grafana.Workspace(
    "grafana",
    {
        accountAccessType: "CURRENT_ACCOUNT",
        authenticationProviders: ["AWS_SSO"],
        permissionType: "CUSTOMER_MANAGED",
        roleArn: workspaceRole.arn,
    }
);
export const grafanaEndpoint = grafana.endpoint;

const apiKey = new aws.grafana.WorkspaceApiKey(
    "external-grafana-editor",
    {
        keyName: "external-grafana-editor",
        keyRole: "ADMIN",
        secondsToLive: 60 * 60 * 24 * 30,
        workspaceId: grafana.id,
    }
)
export const grafanaApiKey = apiKey.key;