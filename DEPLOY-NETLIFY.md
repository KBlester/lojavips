# Deploy da SAPUCAIA na Netlify

## Variáveis de ambiente

Configure em **Netlify → Project configuration → Environment variables**:

### Obrigatória
- `ADMIN_SESSION_SECRET` — chave aleatória forte para as sessões do painel.

### Discord OAuth
- `DISCORD_CLIENT_ID`
- `DISCORD_CLIENT_SECRET`
- `DISCORD_SESSION_SECRET`
- `DISCORD_REDIRECT_URI` — normalmente `https://SEU-DOMINIO/api/discord-callback`.

O código não depende mais do domínio antigo `wondrous-sunshine-514b38.netlify.app`. Se `DISCORD_REDIRECT_URI` não for definida, ele usa automaticamente o domínio da requisição atual.

### Pagamentos
Mercado Pago:
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`

InfinitePay:
- `INFINITEPAY_HANDLE`

### Entrega FiveM
- `FIVEM_WEBHOOK_URL`
- `FIVEM_WEBHOOK_SECRET`

### E-mail (opcional)
Configure os dois juntos:
- `RESEND_API_KEY`
- `EMAIL_FROM`

## Webhooks

Mercado Pago:
`https://SEU-DOMINIO/api/webhook-mercadopago`

InfinitePay:
`https://SEU-DOMINIO/api/webhook-infinitepay`

## Importante

- Não coloque tokens, secrets ou chaves privadas em HTML/JavaScript público.
- Não commite arquivos `.env`.
- O banco usa Netlify Blobs; não é necessário `DATABASE_URL`, MongoDB, Supabase etc.
- Depois de alterar variáveis no Netlify, faça um novo deploy para garantir que as Functions recebam a configuração.
