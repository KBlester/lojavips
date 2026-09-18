# Configuração do pagamento

Esta versão altera somente o fluxo de checkout/pagamento da V2.

## Mercado Pago — Pix real

No Netlify, configure:

`MP_ACCESS_TOKEN`

Webhook do Mercado Pago:

`https://SEU-SITE.netlify.app/api/webhook-mercadopago`

O checkout cria o pagamento Pix no backend e mostra `qr_code_base64`, `qr_code` (Pix Copia e Cola) e `ticket_url` quando retornados pelo Mercado Pago. A API exige uma chave de idempotência no pagamento. citeturn238355search0turn238355search8

## InfinitePay

Configure:

`INFINITEPAY_HANDLE`

A opção InfinitePay cria um link de Checkout Integrado e redireciona o cliente para a página de pagamento. A integração também pode usar webhook para confirmar a venda. citeturn435347search0turn435347search3

Webhook:

`https://SEU-SITE.netlify.app/api/webhook-infinitepay`

## Discord OAuth opcional

`DISCORD_CLIENT_ID`
`DISCORD_CLIENT_SECRET`
`DISCORD_REDIRECT_URI=https://SEU-SITE.netlify.app/api/discord-callback`
`DISCORD_SESSION_SECRET=uma-chave-secreta-grande-e-aleatoria`

## Entrega FiveM

`FIVEM_WEBHOOK_URL`
`FIVEM_WEBHOOK_SECRET`

O campo `recipientId` é o ID/Passaporte **do destinatário**. Ele não é tratado como ID do comprador.

## E-mail

Opcional:

`RESEND_API_KEY`
`EMAIL_FROM=Loja SAPUCAIA <noreply@seu-dominio.com>`

O e-mail de confirmação usa o e-mail informado pelo comprador.
