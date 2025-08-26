import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { AWSConfig, PersistenceConfig, OpenSearchConfig } from "./types";
import { ClusterComponent } from "./ClusterComponent";
import { PersistenceComponent } from "./PersistenceComponent";

export interface VisibilityComponentArgs {
    awsConfig: AWSConfig;
    config: PersistenceConfig;
    cluster: ClusterComponent;
    persistence: PersistenceComponent;
}

export class VisibilityComponent extends pulumi.ComponentResource {
    public readonly visibilityValues: pulumi.Output<any>;
    public readonly elasticsearchValues: pulumi.Output<any>;

    constructor(name: string, args: VisibilityComponentArgs, opts?: pulumi.ComponentResourceOptions) {
        super("benchmark:infrastructure:Visibility", name, {}, opts);

        // Use OpenSearch for visibility if configured (typically with Cassandra)
        if (args.config.Visibility?.OpenSearch) {
            const opensearchValues = this.createOpenSearchVisibility(name, args.config.Visibility.OpenSearch, args.cluster, args.awsConfig);
            this.visibilityValues = pulumi.output({});
            this.elasticsearchValues = opensearchValues;
        } else if (args.config.RDS != undefined) {
            // For SQL persistence without OpenSearch, use same connection with different database
            this.visibilityValues = args.persistence.values.apply(values => {
                return {
                    driver: "sql",
                    sql: {
                        ...values.sql,
                        database: "temporal_visibility"
                    }
                };
            });
            this.elasticsearchValues = pulumi.output({ enabled: false });
        } else {
            throw new Error("invalid visibility config: RDS or OpenSearch required");
        }

        this.registerOutputs({
            visibilityValues: this.visibilityValues,
            elasticsearchValues: this.elasticsearchValues
        });
    }

    private createOpenSearchVisibility(name: string, config: OpenSearchConfig, cluster: ClusterComponent, awsConfig: AWSConfig): pulumi.Output<any> {
        const opensearchSecurityGroup = new aws.ec2.SecurityGroup(name + "-opensearch", {
            vpcId: awsConfig.VpcId,
        }, { parent: this });

        new aws.ec2.SecurityGroupRule(name + "-opensearch", {
            securityGroupId: opensearchSecurityGroup.id,
            type: 'ingress',
            sourceSecurityGroupId: cluster.securityGroup,
            protocol: "tcp",
            fromPort: 443,
            toPort: 443,
        }, { parent: this });

        const zoneCount = awsConfig.AvailabilityZones.length;
        const domain = new aws.opensearch.Domain(name, {
            clusterConfig: {
                instanceType: config.InstanceType,
                instanceCount: zoneCount,
                zoneAwarenessEnabled: true,
                zoneAwarenessConfig: {
                    availabilityZoneCount: zoneCount,
                }
            },
            vpcOptions: {
                subnetIds: awsConfig.PrivateSubnetIds,
                securityGroupIds: [opensearchSecurityGroup.id],
            },
            ebsOptions: {
                ebsEnabled: true,
                volumeType: "gp3",
                volumeSize: 100,
            },
            engineVersion: config.EngineVersion,
            accessPolicies: JSON.stringify({
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Effect": "Allow",
                        "Principal": {
                            "AWS": "*"
                        },
                        "Action": "es:*",
                        "Resource": "*"
                    }
                ]
            })
        }, { parent: this });

        const policy = new aws.iam.Policy("opensearch-policy", {
            policy: JSON.stringify({
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Action": [
                            "es:ESHttpPost",
                            "es:ESHttpPut",
                            "es:ESHttpGet",
                            "es:ESHttpDelete",
                            "es:ESHttpHead"
                        ],
                        "Effect": "Allow",
                        "Resource": "*"
                    }
                ]
            })
        }, { parent: this });

        cluster.instanceRoles.apply(roles => {
            roles.forEach((role, i) => {
                new aws.iam.RolePolicyAttachment(`opensearch-role-policy-${i}`, { 
                    role: role, 
                    policyArn: policy.arn 
                }, { parent: this });
            });
        });

        const proxyDeployment = new k8s.apps.v1.Deployment("opensearch-proxy", {
            metadata: {
                labels: {
                    "app.kubernetes.io/name": "opensearch-proxy",
                    "name": "opensearch-proxy",
                }
            },
            spec: {
                replicas: 2,
                selector: {
                    matchLabels: {
                        "app.kubernetes.io/name": "opensearch-proxy"
                    },
                },
                template: {
                    metadata: {
                        labels: {
                            "app.kubernetes.io/name": "opensearch-proxy",
                        },
                    },
                    spec: {
                        containers: [
                            {
                                image: "public.ecr.aws/aws-observability/aws-sigv4-proxy:latest",
                                imagePullPolicy: "Always",
                                name: "opensearch-proxy",
                                args: [
                                    "--verbose",
                                    "--log-failed-requests",
                                    "--log-signing-process",
                                    "--no-verify-ssl",
                                    "--name", "es",
                                    "--region", awsConfig.Region,
                                    "--host", domain.endpoint,
                                ],
                                ports: [
                                    {
                                        name: "http",
                                        containerPort: 8080,
                                        protocol: "TCP",
                                    }
                                ],
                            },
                        ],
                        restartPolicy: "Always",
                    },  
                },
            },
        }, { 
            provider: cluster.provider,
            parent: this 
        });

        const proxyService = new k8s.core.v1.Service("opensearch-proxy", {
            metadata: {
                name: "opensearch-proxy",
                labels: {
                    "app.kubernetes.io/name": "opensearch-proxy",
                }
            },
            spec: {
                selector: {
                    "app.kubernetes.io/name": "opensearch-proxy",
                },
                ports: [
                    {
                        name: "http",
                        port: 80,
                        protocol: "TCP",
                        targetPort: "http",
                    }
                ],
            },
        }, { 
            provider: cluster.provider, 
            dependsOn: [proxyDeployment],
            parent: this 
        });

        return pulumi.output({
            enabled: false,
            external: true,
            version: "v7",
            scheme: "http",
            host: "opensearch-proxy.default.svc.cluster.local",
            port: 80
        });
    }
}
