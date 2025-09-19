import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { AWSConfig, PersistenceConfig, RDSPersistenceConfig, CassandraPersistenceConfig } from "./types";
import { ClusterComponent } from "./ClusterComponent";

export interface PersistenceComponentArgs {
    awsConfig: AWSConfig;
    config: PersistenceConfig;
    cluster: ClusterComponent;
    shards: number;
}

export class PersistenceComponent extends pulumi.ComponentResource {
    public readonly values: pulumi.Output<any>;

    constructor(name: string, args: PersistenceComponentArgs, opts?: pulumi.ComponentResourceOptions) {
        super("benchmark:infrastructure:Persistence", name, {}, opts);

        if (args.config.RDS != undefined) {
            this.values = this.createRdsPersistence(name, args.config.RDS, args.cluster, args.awsConfig, args.shards);
        } else if (args.config.Cassandra != undefined) {
            this.values = this.createCassandraPersistence(name, args.config.Cassandra, args.cluster, args.awsConfig);
        } else {
            throw new Error("invalid persistence config");
        }

        this.registerOutputs({
            values: this.values
        });
    }

    private createRdsPersistence(name: string, config: RDSPersistenceConfig, cluster: ClusterComponent, awsConfig: AWSConfig, shards: number): pulumi.Output<any> {
        let dbPort: number;
        let dbDriver: string;

        if (config.Engine == "postgres" || config.Engine == "aurora-postgresql") {
            dbDriver = "postgres12";
            dbPort = 5432;
        } else if (config.Engine == "mysql" || config.Engine == "aurora-mysql") {
            dbDriver = "mysql8";
            dbPort = 3306;
        } else {
            throw new Error("invalid RDS config");
        }

        const rdsSecurityGroup = new aws.ec2.SecurityGroup(name + "-rds", {
            vpcId: awsConfig.VpcId,
        }, { parent: this });

        new aws.ec2.SecurityGroupRule(name + "-rds", {
            securityGroupId: rdsSecurityGroup.id,
            type: 'ingress',
            sourceSecurityGroupId: cluster.securityGroup,
            protocol: "tcp",
            fromPort: dbPort,
            toPort: dbPort,
        }, { parent: this });

        let endpoint: pulumi.Output<string>;

        if (config.Engine == "aurora-postgresql" || config.Engine == "aurora-mysql") {
            const engine = config.Engine;

            const rdsCluster = new aws.rds.Cluster(name, {
                availabilityZones: awsConfig.AvailabilityZones.slice(1),
                dbSubnetGroupName: awsConfig.RdsSubnetGroupName,
                vpcSecurityGroupIds: [rdsSecurityGroup.id],
                clusterIdentifierPrefix: name,
                engine: engine,
                engineVersion: config.EngineVersion,
                skipFinalSnapshot: true,
                masterUsername: "temporal",
                masterPassword: "temporal",
            }, { parent: this });

            awsConfig.AvailabilityZones.forEach((zone) => {
                new aws.rds.ClusterInstance(`${name}-${zone}`, {
                    identifierPrefix: name,
                    clusterIdentifier: rdsCluster.id,
                    availabilityZone: zone,
                    engine: engine,
                    engineVersion: config.EngineVersion,
                    instanceClass: config.InstanceType,
                    performanceInsightsEnabled: true,
                }, { parent: this });
            });

            endpoint = rdsCluster.endpoint;
        } else {
            const engine = config.Engine;

            const rdsInstance = new aws.rds.Instance(name, {
                storageType: "gp3",
                storageEncrypted: true,
                allocatedStorage: 1024,
                iops: config.IOPS,
                dbSubnetGroupName: awsConfig.RdsSubnetGroupName,
                vpcSecurityGroupIds: [rdsSecurityGroup.id],
                identifierPrefix: name,
                engine: engine,
                engineVersion: config.EngineVersion,
                instanceClass: config.InstanceType,
                skipFinalSnapshot: true,
                username: "temporal",
                password: "temporal",
                publiclyAccessible: false,
                multiAz: true,
                tags: {
                    "numHistoryShards": shards.toString()
                }
            }, { 
                replaceOnChanges: ["instanceClass", "tags.numHistoryShards"],
                parent: this 
            });

            endpoint = rdsInstance.address;
        }

        return pulumi.output({
            driver: "sql",
            sql: {
                driver: dbDriver,
                host: endpoint,
                port: dbPort,
                database: "temporal_persistence",
                user: "temporal",
                password: "temporal",
                maxConns: 30,
                maxIdleConns: 30,
            }
        });
    }

    private createCassandraPersistence(name: string, config: CassandraPersistenceConfig, cluster: ClusterComponent, awsConfig: AWSConfig): pulumi.Output<any> {
        const namespace = new k8s.core.v1.Namespace("cassandra", { 
            metadata: { name: "cassandra" } 
        }, { 
            provider: cluster.provider,
            parent: this 
        });

        const cassOperator = new k8s.helm.v3.Release('cass-operator', {
            chart: "cass-operator",
            version: "0.61.0",
            namespace: "cassandra",
            repositoryOpts: {
                repo: "https://helm.k8ssandra.io/stable",
            },
            values: {
                admissionWebhooks: {
                    enabled: false,
                },
            }
        }, {
            dependsOn: [namespace],
            provider: cluster.provider,
            parent: this
        });

        // Create the secret for the temporal user
        const cassandraSecret = new k8s.core.v1.Secret('temporal-cassandra-secret', {
            metadata: {
                name: 'temporal-cassandra-secret',
                namespace: 'cassandra',
            },
            type: 'Opaque',
            stringData: {
                username: 'temporal',
                password: 'temporal',
            },
        }, {
            provider: cluster.provider,
            parent: this,
        });

        const cassandraDatacenter = new k8s.apiextensions.CustomResource('cassandra-datacenter', {
            apiVersion: 'cassandra.datastax.com/v1beta1',
            kind: 'CassandraDatacenter',
            metadata: {
                name: 'temporal-cassandra',
                namespace: 'cassandra',
                annotations: {
                    "pulumi.com/waitFor": "condition=Ready",
                    "pulumi.com/timeoutSeconds": (config.NodeCount * 5 * 60).toString(),
                    "pulumi.com/patchForce": "true",
                }
            },
            spec: {
                clusterName: 'temporal',
                datacenterName: 'dc1',
                serverType: 'cassandra',
                serverVersion: '4.1.3',
                size: config.NodeCount,
                superuserSecretName: 'temporal-cassandra-secret',
                storageConfig: {
                    cassandraDataVolumeClaimSpec: {
                        storageClassName: 'gp3',
                        accessModes: ['ReadWriteOnce'],
                        resources: {
                            requests: {
                                storage: config.DataStorage,
                            },
                        },
                    },
                    additionalVolumes: [
                        {
                            name: 'commitlog-volume',
                            mountPath: '/var/lib/cassandra/commitlog',
                            pvcSpec: {
                                storageClassName: 'gp3',
                                accessModes: ['ReadWriteOnce'],
                                resources: {
                                    requests: {
                                        storage: config.CommitLogStorage,
                                    },
                                },
                            },
                        },
                    ],
                },
                resources: {
                    requests: {
                        cpu: 1,
                        memory: "1Gi",
                    },
                    limits: {
                        cpu: config.CPU.Limit,
                        memory: config.Memory.Limit,
                    },
                },
                nodeSelector: { dedicated: 'cassandra' },
                tolerations: [
                    { key: 'dedicated', operator: 'Equal', value: 'cassandra', effect: 'NoSchedule' }
                ],
                racks: awsConfig.AvailabilityZones.map((zone, index) => ({
                    name: `rack${index + 1}`,
                    nodeAffinityLabels: {
                        'topology.kubernetes.io/zone': zone,
                    },
                })),
                podTemplateSpec: {
                    spec: {
                        containers: [
                            { name: 'cassandra' },
                        ],
                    },
                },
                config: {
                    'cassandra-yaml': {
                        num_tokens: 8,
                    },
                },
                managementApiAuth: {
                    insecure: {},
                },
            },
        }, {
            dependsOn: [cassOperator, cassandraSecret],
            provider: cluster.provider,
            parent: this,
        });

        return pulumi.output({
            driver: "cassandra",
            cassandra: {
                hosts: ['temporal-temporal-cassandra-service.cassandra.svc.cluster.local'],
                port: 9042,
                keyspace: "temporal_persistence",
                user: "temporal",
                password: "temporal",
                replicationFactor: 3,
                consistency: {
                    default: {
                        consistency: "quorom",
                        serialConsistency: "serial",
                    },
                },
                datacenter: 'dc1',
            }
        });
    }
}
