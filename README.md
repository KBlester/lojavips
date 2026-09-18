# SAPUCAIA — Loja Oficial FiveM

Projeto novo, independente e pronto para publicação no Netlify.

## O que já funciona no frontend

- Banner original da SAPUCAIA rp e baque em `assets/banner-sapucaia.png`
- Animação suave de zoom e brilho no banner sem deformar a art
- Identidade preta + rosa neon
- Menu e categorias funcionais
- Produtos por categoriaa
- Cards com hover, selos e descontooo
- Modal de detalhes do produtoo
- Carrinho com quantidade, remoção e subtotal
- Cupom `SAPUCAIA50` aplicando 50% OFF no frontend
- Persistência do carrinho no `localStorage`
- Área de suporte e FAQ
- Área de pedidos preparada para backend
- Botão de Discord preparado para OAuth
- Responsivo para PC e celular
- Partículas e efeitos de fundo leves
- Nenhum pagamento real é inventado nesta versãoo

## Publicar no Netlify

1. Extraia o ZIP.
2. Entre no Netlify.
3. Escolha a opção para adicionar um novo site/projeto.
4. Faça upload da pasta `sapucaia-loja` ou conecte um repositório Git.
5. Como é um projeto HTML/CSS/JS puro, não existe etapa de build.
6. O arquivo `netlify.toml` já está incluído.

## Integrações futuras

O frontend deixa pontos claros para conectar:

- Mercado Pago / Pix
- Discord OAuth
- Banco de dados
- Sistema de pedidos
- Webhook
- Entrega automática no FiveM

Essas integrações exigem backend/servidor seguro. Não coloque tokens, client secrets ou chaves privadas diretamente no `script.js`.

## Arquivos principais

- `index.html` — estrutura da loja
- `style.css` — identidade visual, responsividade e animações
- `script.js` — produtos, categorias, modal, carrinho e cupoom
- `assets/banner-sapucaia.png` — banner original enviado
- `assets/*.svg` — artes locais dos produtos de demonstração
- `netlify.toml` — configuração simples para Netlify


## V2 — Painel ADM

Abra `admin.html` para acessar o painel administrativo..

### Login de demonstração

- Usuário: `admin`
- Senha: `sapucaia`

O painel V2 inclui:

- Dashboard com métricas
- Cadastro, edição e exclusão de produtos
- Categorias
- Pedidos locais e alteração de status
- Clientes (estrutura preparada)
- Configuração do cupom e percentual de desconto
- Atalho para abrir a loja
- Sessão administrativa local
- Área de configurações das integrações futuras

### Importante sobre segurança

Esta versão continua sendo **frontend-only**. O login ADM usa localStorage e, portanto, **não é segurança de produção**. Qualquer pessoa que tenha os arquivos pode inspecionar o código. Antes de usar para vendas reais, a autenticação e todas as operações administrativas precisam ser movidas para um backend seguro, com banco de dados e autorização no servidor.

### Como testar

1. Abra `admin.html`.
2. Entre com `admin` / `sapucaia`.
3. Crie ou edite um produto.
4. Abra `index.html` em outra aba.
5. O catálogo da loja usa o catálogo salvo pelo painel.
6. Adicione produtos ao carrinho e avance no checkout para criar um pedido local.
7. Volte ao painel e veja o pedido na área "Pedidos".
