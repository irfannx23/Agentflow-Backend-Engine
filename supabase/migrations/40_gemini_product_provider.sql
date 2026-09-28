-- CostPilot Phase 13 — Gemini product usage provider
-- Extends the existing product-intelligence provider allowlist without
-- changing table structure or weakening validation.

alter table public.provider_connections
    drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections
    add constraint provider_connections_provider_check
        check (provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo', 'deepseek', 'gemini'));
alter table public.usage_records
    drop constraint if exists usage_records_provider_check;
alter table public.usage_records
    add constraint usage_records_provider_check
        check (provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo', 'deepseek', 'gemini'));
alter table public.budgets
    drop constraint if exists budgets_provider_check;
alter table public.budgets
    add constraint budgets_provider_check
        check (provider is null or provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo', 'deepseek', 'gemini'));
alter table public.product_alerts
    drop constraint if exists product_alerts_provider_check;
alter table public.product_alerts
    add constraint product_alerts_provider_check
        check (provider is null or provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo', 'deepseek', 'gemini'));
alter table public.cost_recommendations
    drop constraint if exists cost_recommendations_provider_check;
alter table public.cost_recommendations
    add constraint cost_recommendations_provider_check
        check (provider is null or provider in ('openai', 'anthropic', 'aws', 'google', 'azure', 'demo', 'deepseek', 'gemini'));
