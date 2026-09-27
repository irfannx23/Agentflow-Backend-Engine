# Configuration

`.env.example` is the name-only configuration reference. Provider credentials and service-role keys are required only by workflows that declare them. Optional gateways and webhook ingress remain optional.

Configuration is loaded by explicit requirement lists. Missing required variables fail validation; missing optional variables are reported. Secret names are classified by integration metadata and values are redacted from diagnostics.

Never commit values, embed credentials in workflow JSON, expose service-role credentials to a browser, or print environment contents during troubleshooting.
