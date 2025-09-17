import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { ClusterComponent } from "./ClusterComponent";
import { AWSConfig } from "./types";

export interface MonitoringComponentArgs {
    awsConfig: AWSConfig;
    cluster: ClusterComponent;
    config: any;
}

export class MonitoringComponent extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly crds: k8s.helm.v4.Chart;
    public readonly prometheusStack: k8s.helm.v4.Chart;
    public readonly alertRules: k8s.apiextensions.CustomResource;

    private readonly awsConfig: AWSConfig;
    private readonly benchmarkConfig: any;
    private readonly cluster: ClusterComponent;

    constructor(name: string, args: MonitoringComponentArgs, opts?: pulumi.ComponentResourceOptions) {
        super("benchmark:infrastructure:Monitoring", name, {}, opts);

        this.awsConfig = args.awsConfig;
        this.benchmarkConfig = args.config;
        this.cluster = args.cluster;

        // Create monitoring namespace
        this.namespace = new k8s.core.v1.Namespace("monitoring", { 
            metadata: { name: "monitoring" } 
        }, { parent: this });

        const oidcProviderUrl = this.cluster.eksCluster.oidcProviderUrl;
        const oidcProviderArn = this.cluster.eksCluster.oidcProviderArn;

        const role = pulumi.all([oidcProviderUrl, oidcProviderArn, this.namespace.metadata.name]).apply(([url, arn, namespace]) => {
            const aud = url.replace("https://","") + ":aud";
            const sub = url.replace("https://","") + ":sub";
            return new aws.iam.Role("amp-writer-role", {
                assumeRolePolicy: JSON.stringify({
                    Version: "2012-10-17",
                    Statement: [
                        {
                            Effect: "Allow",
                            Principal: {
                                Federated: arn,
                            },
                            Action: "sts:AssumeRoleWithWebIdentity",
                            Condition: {
                                StringEquals: {
                                    [`${aud}`]: `sts.amazonaws.com`,
                                    [`${sub}`]: `system:serviceaccount:${namespace}:prometheus-remote-write`,
                                },
                            },
                        }
                    ],
                }),
            });
        });

        new aws.iam.RolePolicyAttachment("amp-writer-query-policy", {
            role: role.name,
            policyArn: "arn:aws:iam::aws:policy/AmazonPrometheusQueryAccess",
        });

        new aws.iam.RolePolicyAttachment("amp-writer-write-policy", {
            role: role.name,
            policyArn: "arn:aws:iam::aws:policy/AmazonPrometheusRemoteWriteAccess",
        });

        const prometheus = aws.amp.Workspace.get("prometheus", this.awsConfig.PrometheusId);

        // Install Kube Prometheus Stack
        this.prometheusStack = new k8s.helm.v4.Chart('kube-prometheus-stack', {
            chart: "kube-prometheus-stack",
            version: "72.7.0",
            namespace: this.namespace.metadata.name,
            repositoryOpts: {
                repo: "https://prometheus-community.github.io/helm-charts",
            },
            values: {
                prometheus: {
                    serviceAccount: {
                        create: true,
                        name: "prometheus-remote-write",
                        annotations: {
                            "eks.amazonaws.com/role-arn": role.arn,
                        },
                    },
                    prometheusSpec: {
                        podMonitorSelectorNilUsesHelmValues: false,
                        serviceMonitorSelectorNilUsesHelmValues: false,
                        ruleSelectorNilUsesHelmValues: false,
                        externalLabels: {
                            "cluster": pulumi.getStack(),
                            "clusterSize": pulumi.getStack().match(/small|medium|x*large/)?.[0],
                        },
                        remoteWrite: [
                            {
                                url: pulumi.interpolate `${prometheus.prometheusEndpoint}/api/v1/remote_write`,
                                sigv4: {
                                    region: this.awsConfig.Region,
                                },
                                queueConfig: {
                                    maxSamplesPerSend: 1000,
                                    maxShards: 200,
                                    capacity: 2500,
                                },
                                writeRelabelConfigs: [
                                    {
                                        sourceLabels: ["exported_namespace"],
                                        regex: '(.+)',
                                        targetLabel: "namespace",
                                    },
                                    {
                                        regex: "exported_namespace",
                                        action: "labeldrop",
                                    }
                                ],
                            }
                        ]
                    },
                },
                prometheusOperator: {
                    tls: {
                        enabled: false,
                    }
                },
            },
        }, { 
            parent: this,
            dependsOn: [this.namespace],
        });

        // Add Prometheus Rules for benchmark monitoring
        this.alertRules = new k8s.apiextensions.CustomResource("benchmark-alerts", {
            apiVersion: "monitoring.coreos.com/v1",
            kind: "PrometheusRule",
            metadata: {
                name: "benchmark-alerts",
                namespace: this.namespace.metadata.name,
                labels: {
                    "app.kubernetes.io/name": "kube-prometheus-stack",
                    "app.kubernetes.io/instance": "kube-prometheus-stack",
                }
            },
            spec: {
                groups: [
                    {
                        name: "temporal.benchmarks.recording",
                        interval: "30s",
                        rules: [
                            {
                                record: "benchmark:state_transition_rate",
                                expr: `sum(rate(state_transition_count_count{exported_namespace=~"benchmark_.*"}[1m]))`,
                            },
                            {
                                record: "benchmark:resource:allocatable_total",
                                expr: `sum(kube_node_status_allocatable * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="workers"} > 0)) by (resource)`,
                            },
                            {
                                record: "cassandra:resource:allocatable_total",
                                expr: `sum(kube_node_status_allocatable * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="cassandra"} > 0)) by (resource)`,
                            },
                            {
                                record: "temporal:resource:allocatable_total",
                                expr: `sum(kube_node_status_allocatable * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="temporal"} > 0)) by (resource)`,
                            },
                            {
                                record: "benchmark:resource:requests_total",
                                expr: `sum(kube_pod_container_resource_requests * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="workers"} > 0)) by (resource)`,
                            },
                            {
                                record: "cassandra:resource:requests_total",
                                expr: `sum(kube_pod_container_resource_requests * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="cassandra"} > 0)) by (resource)`,
                            },
                            {
                                record: "temporal:resource:requests_total",
                                expr: `sum(kube_pod_container_resource_requests * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="temporal"} > 0)) by (resource)`,
                            },
                            {
                                record: "benchmark:service:cpu_usage_ratio",
                                expr: `sum(rate(container_cpu_usage_seconds_total{container="benchmark-workers"}[1m]) * on(namespace,pod) group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{namespace="benchmark", workload=~"benchmark-workers-.*-workers"}) by (pod, container) / sum(kube_pod_container_resource_requests{job="kube-state-metrics",namespace="benchmark",resource="cpu",container="benchmark-workers"} * on(namespace,pod) group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{namespace="benchmark", workload=~"benchmark-workers-.*-workers"}) by (pod, container)`,
                            },
                            {
                                record: "cassandra:service:cpu_usage_ratio",
                                expr: `sum(rate(container_cpu_usage_seconds_total{container="cassandra"}[1m]) * on(namespace,pod) group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{namespace="cassandra", workload="cassandra"}) by (pod, container) / sum(kube_pod_container_resource_requests{job="kube-state-metrics",namespace="cassandra",resource="cpu",container="cassandra"} * on(namespace,pod) group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{namespace="cassandra", workload="cassandra"}) by (pod, container)`,
                            },
                            {
                                record: "temporal:service:cpu_usage_ratio",
                                expr: `label_replace(sum(rate(container_cpu_usage_seconds_total{container=~"temporal-(frontend|history|matching)"}[1m]) * on(namespace,pod) group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{namespace="temporal", workload=~"temporal-(frontend|history|matching)"}) by (pod, container) / sum(kube_pod_container_resource_requests{job="kube-state-metrics",namespace="temporal",resource="cpu",container=~"temporal-(frontend|history|matching)"} * on(namespace,pod) group_left(workload, workload_type) namespace_workload_pod:kube_pod_owner:relabel{namespace="temporal", workload=~"temporal-(frontend|history|matching)"}) by (pod, container), "service", "$1", "container", "temporal-(.+)")`,
                            },
                        ],
                    },
                    {
                        name: "temporal.benchmarks.tuning",
                        interval: "30s",
                        rules: [
                             {
                                alert: "TemporalServiceResourceExhausted",
                                expr: 'sum(rate(service_errors_resource_exhausted[1m])) by (service_name, resource_exhausted_scope, resource_exhausted_cause) > 0',
                                for: "30s",
                                labels: {
                                    severity: "warning",
                                    service: "{{ $labels.service_name }}",
                                },
                                annotations: {
                                    summary: "Temporal {{ $labels.service_name }} experiencing resource exhausted errors, scope: {{ $labels.resource_exhausted_scope }}, cause: {{ $labels.resource_exhausted_cause }}",
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
                            {
                                alert: "BenchmarkHighCPUUsage",
                                expr: 'benchmark:service:cpu_usage_ratio > 0.85',
                                for: "1m",
                                labels: {
                                    severity: "warning",
                                },
                                annotations: {
                                    summary: "High CPU usage in Benchmark",
                                    description: "Benchmark pod {{ $labels.pod }} is using more than 85% of requested CPU",
                                },
                            },
                            {
                                alert: "CassandraExcessCPULimits",
                                expr: 'avg(cassandra:service:cpu_usage_ratio) < 0.6',
                                for: "1m",
                                labels: {
                                    impact: "slo",
                                    severity: "warning",
                                },
                                annotations: {
                                    summary: "Excess CPU limits for Cassandra",
                                    description: "Cassandra pods are using less than 60% of requested CPU on average",
                                },
                            },
                            {
                                alert: "TemporalExcessNodeSpareCapacity",
                                expr: `temporal:resource:requests_total{resource="cpu"} / temporal:resource:allocatable_total{resource="cpu"} < 0.5`,
                                for: "1m",
                                labels: {
                                    impact: "slo",
                                    severity: "warning",
                                },
                                annotations: {
                                    summary: "Temporal has excess spare CPU capacity",
                                    description: "Temporal pods have requested less than 50% of available CPU capacity.",
                                },
                            },
                        ],
                    },
                    {
                        name: "temporal.benchmarks.slo",
                        interval: "30s",
                        rules: [
                            {
                                alert: "TemporalHighWorkflowTaskLatency",
                                expr: 'histogram_quantile(0.95, sum by(exported_namespace, le) (rate(temporal_workflow_task_schedule_to_start_latency_bucket{exported_namespace=~"benchmark_.*"}[1m]))) > 0.150',
                                for: "1m",
                                labels: {
                                    impact: "slo",
                                    severity: "warning",
                                },
                                annotations: {
                                    summary: "High workflow task latency detected",
                                    description: "95th percentile of workflow task schedule-to-start latency in the {{ $labels.exported_namespace }} namespace is above 150ms",
                                },
                            },
                            {
                                alert: "TemporalHighActivityTaskLatency",
                                expr: 'histogram_quantile(0.95, sum by(exported_namespace, le) (rate(temporal_activity_schedule_to_start_latency_bucket{exported_namespace=~"benchmark_.*"}[1m]))) > 0.150',
                                for: "1m",
                                labels: {
                                    impact: "slo",
                                    severity: "warning",
                                },
                                annotations: {
                                    summary: "High activity task latency detected",
                                    description: "95th percentile of activity task schedule-to-start latency in the {{ $labels.exported_namespace }} namespace is above 150ms",
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
                                alert: "CassandraHighCPUUsage",
                                expr: 'cassandra:service:cpu_usage_ratio > 0.66',
                                for: "1m",
                                labels: {
                                    impact: "slo",
                                    severity: "warning",
                                },
                                annotations: {
                                    summary: "High CPU usage in Cassandra",
                                    description: "Cassandra pod {{ $labels.pod }} is using more than 66% of requested CPU",
                                },
                            },
                            {
                                alert: "TemporalInsufficientNodeSpareCapacity",
                                expr: `temporal:resource:requests_total / temporal:resource:allocatable_total > 0.66`,
                                for: "1m",
                                labels: {
                                    impact: "slo",
                                    severity: "warning",
                                },
                                annotations: {
                                    summary: "Temporal pods would not survive an AZ failure - insufficient spare {{ $labels.resource }} capacity",
                                    description: "Temporal nodes are using more than 66% of available {{ $labels.resource }} capacity. With nodes evenly distributed across 3 AZs, this leaves insufficient capacity to reschedule all pods if one AZ fails.",
                                },
                            },
                            {
                                alert: "TemporalLowStateTransitionRate",
                                expr: `benchmark:state_transition_rate < ${this.benchmarkConfig.Target}`,
                                for: "1m",
                                labels: {
                                    impact: "slo",
                                    severity: "warning",
                                },
                                annotations: {
                                    summary: "Low state transition rate detected",
                                    description: `State transition rate is below target of ${this.benchmarkConfig.Target} transitions per second`,
                                },
                            },
                        ],
                    },
                ],
            },
        }, { 
            parent: this,
            dependsOn: [this.prometheusStack],
        });

        this.registerOutputs({
            namespace: this.namespace,
            prometheusStack: this.prometheusStack,
            alertRules: this.alertRules
        });
    }
}
