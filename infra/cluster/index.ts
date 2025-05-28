import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";
import { AWSConfig, BenchmarkConfig, ClusterConfig, PersistenceConfig, TemporalConfig, Cluster, EKSClusterConfig, RDSPersistenceConfig, CassandraPersistenceConfig, OpenSearchConfig } from "./types";

let config = new pulumi.Config();
const awsConfig = config.requireObject<AWSConfig>('AWS');

type Values = pulumi.Output<any>;

function createCluster(clusterConfig: ClusterConfig, persistenceConfig: PersistenceConfig): Cluster {
    if (clusterConfig.EKS != undefined) {
        return eksCluster(pulumi.getStack(), clusterConfig.EKS, persistenceConfig)
    }

    throw("invalid cluster config")
}

function eksCluster(name: string, config: EKSClusterConfig, persistenceConfig: PersistenceConfig): Cluster {
    const identity = aws.getCallerIdentity({});
    const role = pulumi.concat('arn:aws:iam::', identity.then(current => current.accountId), ':role/', awsConfig.Role);

    const kubeconfigOptions: eks.KubeconfigOptions = { roleArn: role }

    const cluster = new eks.Cluster(name, {
        providerCredentialOpts: kubeconfigOptions,
        vpcId: awsConfig.VpcId,
        privateSubnetIds: awsConfig.PrivateSubnetIds,
        nodeAssociatePublicIpAddress: false,
        instanceType: config.NodeType,
        desiredCapacity: config.NodeCount,
        minSize: config.NodeCount,
        maxSize: config.NodeCount
    });

    const temporalNodeGroup = new eks.NodeGroupV2(name + '-temporal', {
        cluster: cluster,
        instanceType: config.TemporalNodeType,
        nodeAssociatePublicIpAddress: false,
        extraNodeSecurityGroups: cluster.nodeSecurityGroup.apply(sg => [sg!]),
        desiredCapacity: config.TemporalNodeCount,
        minSize: config.TemporalNodeCount,
        maxSize: config.TemporalNodeCount,
        labels: {
            dedicated: "temporal",
        },
        taints: {
            "dedicated": { value: "temporal", effect: "NoSchedule" }
        }
    })

    const workerNodeGroup = new eks.NodeGroupV2(name + '-worker', {
        cluster: cluster,
        instanceType: config.WorkerNodeType,
        nodeAssociatePublicIpAddress: false,
        extraNodeSecurityGroups: cluster.nodeSecurityGroup.apply(sg => [sg!]),
        desiredCapacity: config.WorkerNodeCount,
        minSize: config.WorkerNodeCount,
        maxSize: config.WorkerNodeCount,
        labels: {
            dedicated: "worker",
        },
        taints: {
            "dedicated": { value: "worker", effect: "NoSchedule" }
        }
    })

    if (persistenceConfig.Cassandra) {
        const cassandraConfig = persistenceConfig.Cassandra;

        new eks.NodeGroupV2(name + '-cassandra', {
            cluster: cluster,
            instanceType: cassandraConfig.NodeType,
            nodeAssociatePublicIpAddress: false,
            desiredCapacity: cassandraConfig.NodeCount,
            minSize: cassandraConfig.NodeCount,
            maxSize: cassandraConfig.NodeCount,
            labels: {
                dedicated: "cassandra",
            },
            taints: {
                "dedicated": { value: "cassandra", effect: "NoSchedule" }
            }
        })
    }

    return {
        name: cluster.eksCluster.name,
        kubeconfig: cluster.kubeconfig,
        provider: cluster.provider,
        securityGroup: cluster.nodeSecurityGroup.apply(sg => sg!.id),
        instanceRoles: cluster.instanceRoles,
    }
}

function createPersistence(config: PersistenceConfig, cluster: Cluster, shards: number): Values {
    let values: any = {};

    if (config.RDS != undefined) {
        values = rdsPersistence(pulumi.getStack(), config.RDS, cluster.securityGroup, shards);
    } else if (config.Cassandra != undefined) {
        values = cassandraPersistence(pulumi.getStack(), config.Cassandra, cluster);
    } else {
        throw("invalid persistence config");
    }

    return pulumi.output(values);
}

function createVisibility(config: PersistenceConfig, cluster: Cluster, persistence: Values): Values {
    // Use OpenSearch for visibility if configured (typically with Cassandra)
    if (config.Visibility?.OpenSearch) {
        return opensearchVisibility("temporal-visibility", config.Visibility.OpenSearch, cluster);
    }
    
    // For SQL persistence without OpenSearch, use same connection with different database
    if (config.RDS != undefined) {
        return persistence.apply(values => {
            return {
                driver: "sql",
                sql: {
                    ...values.sql,
                    database: "temporal_visibility"
                }
            };
        });
    }
    
    // For Cassandra without OpenSearch, return null to use default
    return pulumi.output(null);
}

function rdsPersistence(name: string, config: RDSPersistenceConfig, securityGroup: pulumi.Output<string>, shards: number): Values {
    let dbPort: number;
    let dbDriver: string;

    if (config.Engine == "postgres" || config.Engine == "aurora-postgresql") {
        dbDriver = "postgres12";
        dbPort = 5432;
    } else if (config.Engine == "mysql" || config.Engine == "aurora-mysql") {
        dbDriver = "mysql8";
        dbPort = 3306;
    } else {
        throw("invalid RDS config");
    }

    const rdsSecurityGroup = new aws.ec2.SecurityGroup(name + "-rds", {
        vpcId: awsConfig.VpcId,
    });
    
    new aws.ec2.SecurityGroupRule(name + "-rds", {
        securityGroupId: rdsSecurityGroup.id,
        type: 'ingress',
        sourceSecurityGroupId: securityGroup,
        protocol: "tcp",
        fromPort: dbPort,
        toPort: dbPort,
    });

    let endpoint: pulumi.Output<String>;

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
        });

        awsConfig.AvailabilityZones.forEach((zone) => {
            new aws.rds.ClusterInstance(`${name}-${zone}`, {
                identifierPrefix: name,
                clusterIdentifier: rdsCluster.id,
                availabilityZone: zone,
                engine: engine,
                engineVersion: config.EngineVersion,
                instanceClass: config.InstanceType,
                performanceInsightsEnabled: true,
            })
        })

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
        }, { replaceOnChanges: ["instanceClass", "tags.numHistoryShards"] });

        endpoint = rdsInstance.address;
    }

    // Configure Helm values for SQL
    const values = {
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
    };

    return pulumi.output(values);
}

function cassandraPersistence(name: string, config: CassandraPersistenceConfig, cluster: Cluster): Values {
    const namespace = new k8s.core.v1.Namespace("cassandra", { metadata: { name: "cassandra" } }, { provider: cluster.provider })
    
    const ebsDriver = new aws.eks.Addon("aws-ebs-csi-driver", {
        clusterName: cluster.name,
        addonName: "aws-ebs-csi-driver",
        addonVersion: "v1.17.0-eksbuild.1",
    });
    
    cluster.instanceRoles.apply(roles => {
        roles.forEach((role, i) => {
            new aws.iam.RolePolicyAttachment(`ebs-driver-role-policy-${i}`, { role: role, policyArn: "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy" })
        })
    })

    const cassandra = new k8s.helm.v3.Chart('cassandra',
        {
            chart: "cassandra",
            version: "9.7.5",
            namespace: "cassandra",
            fetchOpts:{
                repo: "https://charts.bitnami.com/bitnami",
            },
            values: {
                "dbUser": {
                    "user": "temporal",
                    "password": "temporal",
                },
                "replicaCount": config.ReplicaCount,
                "persistence": {
                    "commitLogMountPath": "/bitnami/cassandra/commitlog",
                },
                "tolerations": [
                    { key: "dedicated", operator: "Equal", value: "cassandra", effect: "NoSchedule" },
                ],
            },
        },
        { dependsOn: [namespace, ebsDriver], provider: cluster.provider }
    )

    // Configure Helm values for Cassandra
    const values = {
        driver: "cassandra",
        cassandra: {
            hosts: ["cassandra.cassandra.svc.cluster.local"],
            port: 9042,
            keyspace: "temporal_persistence",
            user: "temporal",
            password: "temporal",
            replicationFactor: 3
        }
    };

    return pulumi.output(values);
}

function opensearchVisibility(name: string, config: OpenSearchConfig, cluster: Cluster): Values {
    const opensearchSecurityGroup = new aws.ec2.SecurityGroup(name + "-opensearch", {
        vpcId: awsConfig.VpcId,
    });
    
    new aws.ec2.SecurityGroupRule(name + "-opensearch", {
        securityGroupId: opensearchSecurityGroup.id,
        type: 'ingress',
        sourceSecurityGroupId: cluster.securityGroup,
        protocol: "tcp",
        fromPort: 443,
        toPort: 443,
    });

    const zoneCount = awsConfig.AvailabilityZones.length
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
            volumeSize: 35,
            iops: 1000,
        },
        engineVersion: config.EngineVersion,
    });
    
    const policy = new aws.iam.Policy("opensearch-access", {
        description: "Opensearch Access",
        policy: JSON.stringify(
            {
                "Version": "2012-10-17",
                "Statement": [
                    {
                        "Action": [
                            "es:*"
                        ],
                        "Effect": "Allow",
                        "Resource": "*"
                    }
                ]
            }        
        )
    })

    cluster.instanceRoles.apply(roles => {
        roles.forEach((role, i) => {
            new aws.iam.RolePolicyAttachment(`opensearch-role-policy-${i}`, { role: role, policyArn: policy.arn })
        })
    })

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
    },
    { provider: cluster.provider })

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
    },
    { provider: cluster.provider, dependsOn: [proxyDeployment] });

    // Configure Helm values for Elasticsearch
    const values = {
        driver: "elasticsearch",
        es: {
            version: "v7",
            url: {
                scheme: "http",
                host: "opensearch-proxy.default.svc.cluster.local",
                port: 80
            },
        }
    };

    return pulumi.output(values);
};

const temporalConfig = config.requireObject<TemporalConfig>('Temporal');
const clusterConfig = config.requireObject<ClusterConfig>('Cluster')
const persistenceConfig = config.requireObject<PersistenceConfig>('Persistence');
const benchmarkConfig = config.requireObject<BenchmarkConfig>('Benchmark');

const cluster = createCluster(clusterConfig, persistenceConfig);
const persistence = createPersistence(persistenceConfig, cluster, temporalConfig.History.Shards);
const visibility = createVisibility(persistenceConfig, cluster, persistence);

const metricsServer = new aws.eks.Addon("metrics-server", {
    clusterName: cluster.name,
    addonName: "metrics-server",
    addonVersion: "v0.7.2-eksbuild.3"
});

const temporalNamespace = new k8s.core.v1.Namespace("temporal", { 
    metadata: { name: "temporal" } 
}, { provider: cluster.provider });

const monitoringNamespace = new k8s.core.v1.Namespace("monitoring", { 
    metadata: { name: "monitoring" } 
}, { provider: cluster.provider });

const monitoringCRDs = new k8s.helm.v4.Chart('monitoring-crds', {
    chart: "prometheus-operator-crds",
    version: "20.0.0",
    namespace: monitoringNamespace.metadata.name,
    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    }
}, { provider: cluster.provider, dependsOn: [monitoringNamespace] });

const kubePrometheusStack = new k8s.helm.v4.Chart('kube-prometheus-stack', {
    chart: "kube-prometheus-stack",
    version: "70.4.1",
    namespace: monitoringNamespace.metadata.name,
    repositoryOpts: {
        repo: "https://prometheus-community.github.io/helm-charts",
    },
    values: {
        crds: {
            enabled: false,
        },
        prometheus: {
            prometheusSpec: {
                podMonitorSelectorNilUsesHelmValues: false,
                serviceMonitorSelectorNilUsesHelmValues: false,
                ruleSelectorNilUsesHelmValues: false,
            },
        },
        prometheusOperator: {
            tls: {
                enabled: false,
            }
        },
    },
}, { provider: cluster.provider, dependsOn: [monitoringNamespace, monitoringCRDs] });

// Add Prometheus Rules for benchmark monitoring
const benchmarkAlertRules = new k8s.apiextensions.CustomResource("benchmark-alerts", {
    apiVersion: "monitoring.coreos.com/v1",
    kind: "PrometheusRule",
    metadata: {
        name: "benchmark-alert-rules",
        namespace: monitoringNamespace.metadata.name,
        labels: {
            "app.kubernetes.io/part-of": "kube-prometheus-stack",
            "prometheus": "kube-prometheus-stack-prometheus",
            "role": "alert-rules",
        },
    },
    spec: {
        groups: [
            {
                name: "temporal.benchmarks.recording",
                interval: "30s",
                rules: [
                    {
                        record: "benchmark:state_transition_rate",
                        expr: `sum(rate(state_transition_count_count{exported_namespace="benchmark"}[1m]))`,
                    },
                    {
                        record: "temporal:resource:allocatable_total",
                        expr: `sum(kube_node_status_allocatable * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="temporal"} > 0)) by (resource)`,
                    },
                    {
                        record: "temporal:resource:requests_total",
                        expr: `sum(kube_pod_container_resource_requests * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="temporal"} > 0)) by (resource)`,
                    },
                    {
                        record: "temporal:resource:largest_node",
                        expr: `max(kube_node_status_allocatable * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="temporal"} > 0)) by (resource)`,
                    },
                    {
                        record: "temporal:service:cpu_usage_ratio",
                        expr: `label_replace(sum(rate(container_cpu_usage_seconds_total{container=~"temporal-(frontend|history|matching)"}[1m]) * on(namespace,pod) group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{namespace="temporal", workload=~"temporal-(frontend|history|matching)"}) by (pod, container) / sum(kube_pod_container_resource_requests{job="kube-state-metrics",namespace="temporal",resource="cpu",container=~"temporal-(frontend|history|matching)"} * on(namespace,pod) group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{namespace="temporal", workload=~"temporal-(frontend|history|matching)"}) by (pod, container), "service", "$1", "container", "temporal-(.+)")`,
                    },
                ],
            },
            {
                name: "temporal.benchmarks.tuning",
                rules: [
                    {
                        alert: "TemporalServiceResourceExhausted",
                        expr: 'sum(rate(service_errors_resource_exhausted[1m])) by (service_name, resource_exhausted_scope) > 0',
                        for: "30s",
                        labels: {
                            severity: "warning",
                            service: "{{ $labels.service_name }}",
                        },
                        annotations: {
                            summary: "Temporal {{ $labels.service_name }} experiencing resource exhausted errors, scope: {{ $labels.resource_exhausted_scope }}",
                            description: "{{ $labels.service_name }} service is returning resource exhausted errors for scope {{ $labels.resource_exhausted_scope }} at {{ $value }} errors per second",
                        },
                    },
                    {
                        alert: "TemporalPersistenceResourceExhausted",
                        expr: 'sum(rate(persistence_errors_resource_exhausted[1m])) by (service_name, resource_exhausted_scope) > 0',
                        for: "30s",
                        labels: {
                            severity: "warning",
                            service: "{{ $labels.service_name }}",
                        },
                        annotations: {
                            summary: "Temporal {{ $labels.service_name }} experiencing persistence resource exhausted errors, scope: {{ $labels.resource_exhausted_scope }}",
                            description: "{{ $labels.service_name }} service is returning persistence resource exhausted errors for scope {{ $labels.resource_exhausted_scope }} at {{ $value }} errors per second",
                        },
                    },
                ],
            },
            {
                name: "temporal.benchmarks.slo",
                rules: [
                    {
                        alert: "TemporalHighWorkflowTaskLatency",
                        expr: 'histogram_quantile(0.95, sum by(le) (rate(temporal_workflow_task_schedule_to_start_latency_bucket{namespace="benchmark"}[1m]))) > 0.150',
                        for: "1m",
                        labels: {
                            impact: "slo",
                            severity: "warning",
                        },
                        annotations: {
                            summary: "High workflow task latency detected",
                            description: "95th percentile of workflow task schedule-to-start latency in the benchmark namespace is above 150ms",
                        },
                    },
                    {
                        alert: "TemporalHighActivityTaskLatency",
                        expr: 'histogram_quantile(0.95, sum by(le) (rate(temporal_activity_schedule_to_start_latency_bucket{namespace="benchmark"}[1m]))) > 0.150',
                        for: "1m",
                        labels: {
                            impact: "slo",
                            severity: "warning",
                        },
                        annotations: {
                            summary: "High activity task latency detected",
                            description: "95th percentile of activity task schedule-to-start latency in the benchmark namespace is above 150ms",
                        },
                    },
                    {
                        alert: "TemporalHighCPUUsage",
                        expr: 'temporal:service:cpu_usage_ratio > 0.85',
                        for: "1m",
                        labels: {
                            impact: "slo",
                            severity: "warning",
                        },
                        annotations: {
                            summary: "High CPU usage in Temporal {{ .service | title }}",
                            description: "{{ .service | title }} pod {{ $labels.pod }} is using more than 85% of requested CPU",
                        },
                    },
                    {
                        alert: "TemporalInsufficientNodeSpareCapacity",
                        expr: `(temporal:resource:allocatable_total - temporal:resource:requests_total) / temporal:resource:largest_node < 1`,
                        for: "1m",
                        labels: {
                            impact: "slo",
                            severity: "warning",
                        },
                        annotations: {
                            summary: "Temporal nodes have less than 1 node's worth of spare {{ $labels.resource }} capacity",
                            description: "Temporal nodes have less than 1 node's worth of spare {{ $labels.resource }} capacity. This may cause the system to be unstable.",
                        },
                    },
                    {
                        alert: "TemporalLowStateTransitionRate",
                        expr: `benchmark:state_transition_rate < ${benchmarkConfig.SoakTest.Target}`,
                        for: "1m",
                        labels: {
                            impact: "slo",
                            severity: "warning",
                        },
                        annotations: {
                            summary: "Low state transition rate detected",
                            description: `State transition rate is below target of ${benchmarkConfig.SoakTest.Target} transitions per second`,
                        },
                    },
                ],
            },
        ],
    },
}, { provider: cluster.provider, dependsOn: [kubePrometheusStack] });

const temporal = new k8s.helm.v4.Chart('temporal',
    {
        chart: "temporal",
        version: "0.62.0",
        namespace: temporalNamespace.metadata.name,
        repositoryOpts: {
            repo: "https://go.temporal.io/helm-charts",
        },
        values: {
            server: {
                config: {
                    numHistoryShards: temporalConfig.History.Shards,
                    persistence: {
                        default: persistence,
                        visibility: visibility,
                    },
                    namespaces: {
                        create: true,
                        namespace: [
                            {
                                name: "benchmark",
                                retention: '1d'
                            }
                        ]
                    }
                },
                dynamicConfig: {
                    ...(temporalConfig.DynamicConfig?.FrontendRPS && {
                        "frontend.rps": [
                            { value: temporalConfig.DynamicConfig.FrontendRPS },
                        ],
                    }),
                    ...(temporalConfig.DynamicConfig?.FrontendNamespaceRPS && {
                        "frontend.namespaceRPS": [
                            { value: temporalConfig.DynamicConfig.FrontendNamespaceRPS },
                        ],
                    }),
                    ...(temporalConfig.DynamicConfig?.MatchingRPS && {
                        "matching.rps": [
                            { value: temporalConfig.DynamicConfig.MatchingRPS },
                        ],
                    }),
                },
                nodeSelector: {
                    dedicated: "temporal"
                },
                tolerations: [
                    { key: "dedicated", operator: "Equal", value: "temporal", effect: "NoSchedule" }
                ],
                metrics: {
                    serviceMonitor: {
                        enabled: true,
                    },
                },
                frontend: {
                    replicaCount: temporalConfig.Frontend.Pods,
                    resources: {
                        requests: {
                            cpu: temporalConfig.Frontend.CPU.Request,
                            memory: temporalConfig.Frontend.Memory.Request,
                        }
                    },
                },
                history: {
                    replicaCount: temporalConfig.History.Pods,
                    resources: {
                        requests: {
                            cpu: temporalConfig.History.CPU.Request,
                            memory: temporalConfig.History.Memory.Request,
                        }
                    },
                },
                matching: {
                    replicaCount: temporalConfig.Matching.Pods,
                    resources: {
                        requests: {
                            cpu: temporalConfig.Matching.CPU.Request,
                            memory: temporalConfig.Matching.Memory.Request,
                        }
                    },
                },
                worker: {
                    replicaCount: temporalConfig.Worker.Pods,
                    resources: {
                        requests: {
                            cpu: temporalConfig.Worker.CPU.Request,
                            memory: temporalConfig.Worker.Memory.Request,
                        }
                    },
                },
            },
            admintools: {
                enabled: false,
                nodeSelector: {
                    dedicated: "temporal"
                },
                tolerations: [
                    { key: "dedicated", operator: "Equal", value: "temporal", effect: "NoSchedule" }
                ],
            },
            prometheus: {
                enabled: false,
            },
            grafana: {
                enabled: false,
            },
            elasticsearch: {
                enabled: false,
            },
            cassandra: {
                enabled: false,
            },
            mysql: {
                enabled: false,
            },
            postgres: {
                enabled: false,
            },
        }
    },
    {
        provider: cluster.provider,
        dependsOn: [temporalNamespace, monitoringCRDs],
        replaceOnChanges: [
            "values.server.config.numHistoryShards",
            "values.server.config.persistence.default.sql.host",
            "values.server.config.visibility.sql.host",
        ],
    }
);

const benchmarkNamespace = new k8s.core.v1.Namespace("benchmark", { 
    metadata: { name: "benchmark" } 
}, { provider: cluster.provider });

const benchmark = new k8s.helm.v4.Chart('benchmark-workers', {
    chart: "oci://ghcr.io/temporalio/charts/benchmark-workers",
    version: "0.3.0",
    namespace: benchmarkNamespace.metadata.name,
    values: {
        temporal: {
            grpcEndpoint: "temporal-frontend.temporal:7233",
            namespace: "benchmark",
            taskQueue: "benchmark",
            workflowTaskPollers: benchmarkConfig.Workers.WorkflowPollers,
            activityTaskPollers: benchmarkConfig.Workers.ActivityPollers,

        },
        metrics: {
            enabled: true,
            serviceMonitor: {
                enabled: true,
            },
        },
        workers: {
            replicaCount: benchmarkConfig.Workers.Pods,
            resources: {
                requests: {
                    cpu: benchmarkConfig.Workers.CPU.Request,
                    memory: benchmarkConfig.Workers.Memory.Request,
                }
            },
        },
        soakTest: {
            enabled: true,
            workflowType: "DSL",
            workflowArgs: '[{"a": "Echo", "i": {"Message": "test"}, "r": 3},{"c": [{"a": "Echo", "i": {"Message": "test"}, "r": 3}]}]',
            replicaCount: benchmarkConfig.SoakTest.Pods,
            concurrentWorkflows: benchmarkConfig.SoakTest.ConcurrentWorkflows,
            resources: {
                requests: {
                    cpu: benchmarkConfig.SoakTest.CPU.Request,
                    memory: benchmarkConfig.SoakTest.Memory.Request,
                }
            },
        },
    },
}, { provider: cluster.provider, dependsOn: [benchmarkNamespace, monitoringCRDs, temporal] });

export const clusterName = cluster.name;
export const kubeconfig = cluster.kubeconfig;
