import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";

export interface MonitoringComponentArgs {}

export class MonitoringComponent extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly crds: k8s.helm.v4.Chart;
    public readonly prometheusStack: k8s.helm.v4.Chart;
    public readonly alertRules: k8s.apiextensions.CustomResource;

    constructor(name: string, args: MonitoringComponentArgs, opts?: pulumi.ComponentResourceOptions) {
        super("benchmark:infrastructure:Monitoring", name, {}, opts);

        // Create monitoring namespace
        this.namespace = new k8s.core.v1.Namespace("monitoring", { 
            metadata: { name: "monitoring" } 
        }, { parent: this });

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
                                record: "temporal:resource:allocatable_total",
                                expr: `sum(kube_node_status_allocatable * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="temporal"} > 0)) by (resource)`,
                            },
                            {
                                record: "temporal:resource:requests_total",
                                expr: `sum(kube_pod_container_resource_requests * on(node) group_left() (kube_node_spec_taint{key="dedicated",value="temporal"} > 0)) by (resource)`,
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
                        rules: [],
                    },
                    {
                        name: "temporal.benchmarks.slo",
                        interval: "30s",
                        rules: [
                            {
                                alert: "TemporalWorkflowTaskScheduleToStartLatencyHigh",
                                expr: 'histogram_quantile(0.95, sum by(le) (rate(temporal_workflow_task_schedule_to_start_latency_bucket{exported_namespace=~"benchmark_.*"}[1m]))) > 0.150',
                                for: "5m",
                                labels: {
                                    severity: "warning"
                                },
                                annotations: {
                                    summary: "Temporal workflow task schedule to start latency is high"
                                }
                            },
                            {
                                alert: "TemporalActivityTaskScheduleToStartLatencyHigh",
                                expr: 'histogram_quantile(0.95, sum by(le) (rate(temporal_activity_schedule_to_start_latency_bucket{exported_namespace=~"benchmark_.*"}[1m]))) > 0.150',
                                for: "5m",
                                labels: {
                                    severity: "warning"
                                },
                                annotations: {
                                    summary: "Temporal activity task schedule to start latency is high"
                                }
                            },
                            {
                                alert: "TemporalServiceCPUUsageHigh",
                                expr: 'temporal:service:cpu_usage_ratio > 0.85',
                                for: "5m",
                                labels: {
                                    severity: "warning"
                                },
                                annotations: {
                                    summary: "Temporal service CPU usage is high"
                                }
                            },
                            {
                                alert: "TemporalResourceUtilizationHigh",
                                expr: `temporal:resource:requests_total / temporal:resource:allocatable_total > 0.66`,
                                for: "5m",
                                labels: {
                                    severity: "warning"
                                },
                                annotations: {
                                    summary: "Temporal resource utilization is high"
                                }
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
