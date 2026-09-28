# Configuration

`.env.example` is the name-only configuration reference. Provider credentials and
service-role keys are required only by the service/workflow that declares them.
Canonical ingress is direct backend-to-n8n dispatch; no third-party webhook gateway
is required.

Configuration is loaded by explicit requirement lists. Missing required variables fail validation; missing optional variables are reported. Secret names are classified by integration metadata and values are redacted from diagnostics.

Never commit values, embed credentials in workflow JSON, expose service-role credentials to a browser, or print environment contents during troubleshooting.
