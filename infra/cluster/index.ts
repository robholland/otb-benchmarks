import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { AWSConfig, ClusterConfig, PersistenceConfig, TemporalConfig, BenchmarkConfig } from "./types";
import { ClusterComponent } from "./ClusterComponent";
import { PersistenceComponent } from "./PersistenceComponent";
import { VisibilityComponent } from "./VisibilityComponent";
import { MonitoringComponent } from "./MonitoringComponent";

const config = new pulumi.Config();
const awsConfig = config.requireObject<AWSConfig>('AWS');
const temporalConfig = config.requireObject<TemporalConfig>('Temporal');
const clusterConfig = config.requireObject<ClusterConfig>('Cluster');
const persistenceConfig = config.requireObject<PersistenceConfig>('Persistence');
const benchmarkConfig = config.requireObject<BenchmarkConfig>('Benchmark');

// Create the EKS cluster
const cluster = new ClusterComponent("cluster", {
    awsConfig: awsConfig,
    config: clusterConfig.EKS!,
    persistenceConfig: persistenceConfig
});

// Create persistence layer (RDS or Cassandra)
const persistence = new PersistenceComponent("persistence", {
    awsConfig: awsConfig,
    config: persistenceConfig,
    cluster: cluster,
    shards: temporalConfig.History.Shards
});

// Create visibility layer (RDS or OpenSearch)
const visibility = new VisibilityComponent("visibility", {
    awsConfig: awsConfig,
    config: persistenceConfig,
    cluster: cluster,
    persistence: persistence
});

// Create monitoring stack
const monitoring = new MonitoringComponent("monitoring", {
    awsConfig: awsConfig,
    cluster: cluster,
    config: benchmarkConfig,
}, { provider: cluster.provider });

// Create temporal namespace
const temporalNamespace = new k8s.core.v1.Namespace("temporal", { 
    metadata: { name: "temporal" } 
}, { provider: cluster.provider });

// Install Temporal
const temporal = new k8s.helm.v4.Chart('temporal', {
    chart: "temporal",
    version: "0.66.0",
    namespace: temporalNamespace.metadata.name,
    repositoryOpts: {
        repo: "https://go.temporal.io/helm-charts",
    },
    values: {
        server: {
            config: {
                numHistoryShards: temporalConfig.History.Shards,
                persistence: {
                    default: persistence.values,
                    visibility: visibility.visibilityValues,
                },
                namespaces: {
                    create: true,
                    namespace: [...Array(benchmarkConfig.Namespaces)].map((_, i) => {
                        return { name: `benchmark-${i+1}`, retention: '1d' }
                    })
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
                ...(temporalConfig.DynamicConfig?.HistoryRPS && {
                    "history.rps": [
                        { value: temporalConfig.DynamicConfig.HistoryRPS },
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
                    },
                },
                env: [
                    {name: "GOMAXPROCS", value: Math.max(1, Math.floor(temporalConfig.Frontend.CPU.Request)).toString()},
                ],
            },
            history: {
                replicaCount: temporalConfig.History.Pods,
                resources: {
                    requests: {
                        cpu: temporalConfig.History.CPU.Request,
                        memory: temporalConfig.History.Memory.Request,
                    },
                },
                env: [
                    {name: "GOMAXPROCS", value: Math.max(1, Math.floor(temporalConfig.History.CPU.Request)).toString()},
                ],
            },
            matching: {
                replicaCount: temporalConfig.Matching.Pods,
                resources: {
                    requests: {
                        cpu: temporalConfig.Matching.CPU.Request,
                        memory: temporalConfig.Matching.Memory.Request,
                    },
                },
                env: [
                    {name: "GOMAXPROCS", value: Math.max(1, Math.floor(temporalConfig.Matching.CPU.Request)).toString()},
                ],
            },
            worker: {
                replicaCount: temporalConfig.Worker.Pods,
                resources: {
                    requests: {
                        cpu: temporalConfig.Worker.CPU.Request,
                        memory: temporalConfig.Worker.Memory.Request,
                    },
                },
                env: [
                    {name: "GOMAXPROCS", value: Math.max(1, Math.floor(temporalConfig.Worker.CPU.Request)).toString()},
                ],
            },
        },
        web: {
            nodeSelector: {
                dedicated: "temporal"
            },
            tolerations: [
                { key: "dedicated", operator: "Equal", value: "temporal", effect: "NoSchedule" }
            ],
        },
        schema: {
            setup: {
                enabled: true,
            },
            update: {
                enabled: true,
            },
        },
        prometheus: {
            enabled: false,
        },
        grafana: {
            enabled: false,
        },
        elasticsearch: {
            ...visibility.elasticsearchValues,
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
}, {
    provider: cluster.provider,
    dependsOn: [temporalNamespace, monitoring, persistence, visibility],
    replaceOnChanges: [
        "values.server.config.numHistoryShards",
        "values.server.config.persistence.default.sql.host",
        "values.server.config.persistence.visibility.sql.host",
    ],
});

// Create benchmark namespace
const benchmarkNamespace = new k8s.core.v1.Namespace(`benchmark`, { 
    metadata: { name: `benchmark` } 
}, { provider: cluster.provider });

const benchmarkCharts = [...Array(benchmarkConfig.Namespaces)].map((_, i) => {
    i += 1;
    return new k8s.helm.v4.Chart(`benchmark-workers-${i}`, {
        chart: "oci://ghcr.io/temporalio/charts/benchmark-workers",
        version: "0.7.2",
        namespace: benchmarkNamespace.metadata.name,
        name: `benchmark-workers-${i}`,
        values: {
            temporal: {
                grpcEndpoint: "dns:///temporal-frontend-headless.temporal:7233",
                namespace: `benchmark-${i}`,
                taskQueue: `benchmark-${i}`,
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
                workflowArgs: '[{"a": "Sleep", "i": {"SleepTimeInSeconds": 1}, "p": 5120, "r": 3},{"c": [{"a": "Sleep", "i": {"SleepTimeInSeconds": 1}, "p": 5120, "r": 3}]}]',
                replicaCount: benchmarkConfig.SoakTest.Pods,
                concurrentWorkflows: Math.floor(benchmarkConfig.ConcurrentWorkflows / benchmarkConfig.Namespaces / benchmarkConfig.SoakTest.Pods),
                resources: {
                    requests: {
                        cpu: benchmarkConfig.SoakTest.CPU.Request,
                        memory: benchmarkConfig.SoakTest.Memory.Request,
                    }
                },
            },
            additionalEnv: [
                {name: "GOMAXPROCS", value: Math.max(1, Math.floor(benchmarkConfig.Workers.CPU.Request)).toString()},
            ],
            tolerations: [
                { key: "dedicated", operator: "Equal", value: "worker", effect: "NoSchedule" }
            ],
            nodeSelector: {
                dedicated: "worker"
            },
        },
    }, { 
        provider: cluster.provider, 
        dependsOn: [benchmarkNamespace, monitoring, temporal]
    });
});

// Export cluster information
export const clusterName = cluster.name;
export const kubeconfig = cluster.kubeconfig;