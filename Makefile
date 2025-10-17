# Makefile for rebuilding all Temporal benchmark reports
#
# This Makefile rebuilds all reports by running Pulumi policy preview
# for each stack configuration found in infra/cluster/

# Define the stacks based on available Pulumi config files
STACKS := small-mysql medium-mysql large-mysql small-cassandra xlarge-cassandra xxlarge-cassandra

# Define the reports directory and pattern
REPORTS_DIR := reports
REPORT_FILES := $(addprefix $(REPORTS_DIR)/,$(addsuffix .md,$(STACKS)))

# Default target
.PHONY: all
all: $(REPORT_FILES)

# Pattern rule to generate reports from stack configurations
$(REPORTS_DIR)/%.md: infra/cluster/Pulumi.%.yaml
	@echo "Generating report for stack: $*"
	@mkdir -p $(REPORTS_DIR)
	cd infra/cluster && pulumi -s $* --policy-pack ../../policy/summary preview --refresh=false
	@if [ ! -f $@ ]; then echo "Warning: Report $@ was not generated"; fi

# Individual stack targets for convenience
.PHONY: $(STACKS)
$(STACKS): %: $(REPORTS_DIR)/%.md

# Clean all generated reports
.PHONY: clean
clean:
	@echo "Cleaning generated reports..."
	rm -f $(REPORT_FILES)

# Build the policy pack before generating reports
.PHONY: build-policy
build-policy:
	@echo "Building policy pack..."
	cd policy/summary && npm run build

# Rebuild everything from scratch
.PHONY: rebuild
rebuild: clean build-policy all

# Show available targets
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  all           - Generate all reports"
	@echo "  rebuild       - Clean, build policy, and generate all reports"
	@echo "  build-policy  - Build the policy pack"
	@echo "  clean         - Remove all generated reports"
	@echo "  help          - Show this help message"
	@echo ""
	@echo "Individual stack targets:"
	@for stack in $(STACKS); do echo "  $$stack"; done
	@echo ""
	@echo "Report files:"
	@for file in $(REPORT_FILES); do echo "  $$file"; done
