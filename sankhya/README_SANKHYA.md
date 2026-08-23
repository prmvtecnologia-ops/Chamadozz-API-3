# Integração Sankhya — AD_CHAMADO

## 1. Criar a tela no Sankhya

1. Acesse o Sankhya → **MGE > Customizações > Metadados**
2. Clique em **Importar**
3. Selecione o arquivo `AD_CHAMADO_metadata.xml`
4. Confirme a importação
5. Vá em **MGE > Customizações > Telas** e crie a tela apontando para a entidade `AD_CHAMADO`

## 2. Criar usuário de integração no Sankhya

1. Crie um usuário específico para a integração (ex: `integracao@eduzz.com`)
2. Dê permissão de **inclusão e alteração** na entidade `AD_CHAMADO`
3. **Não** dê acesso a outras telas — princípio do mínimo privilégio

## 3. Obter o AppKey e Token

1. Acesse o **Portal do Parceiro Sankhya** (parceiro.sankhya.com.br)
2. Crie uma aplicação e copie o `AppKey`
3. No Sankhya → **Configurações > Integrações > Token de Acesso** → gere o token

## 4. Configurar as variáveis de ambiente no Railway

```
SANKHYA_BASE_URL=https://api.sankhya.com.br/gateway/v1
SANKHYA_APP_KEY=sua_app_key
SANKHYA_TOKEN=seu_token
SANKHYA_USER=integracao@eduzz.com
SANKHYA_PASS=senha_do_usuario
```

## 5. Fluxo de dados

```
Usuário abre chamado
        ↓
  Backend Node.js
  (salva no PostgreSQL)
        ↓
  API REST Sankhya
  (grava na AD_CHAMADO)
        ↓
  Admin vê no Sankhya
  com todos os metadados

Admin muda status no sistema web
        ↓
  Backend atualiza PostgreSQL
        ↓
  API REST Sankhya
  (atualiza STATUS na AD_CHAMADO)
```

## 6. Campos gravados na AD_CHAMADO

| Campo             | Descrição                        |
|-------------------|----------------------------------|
| ID                | Código único (CHM-AAAAMMDD-XXXX) |
| TIPO              | Viagem / Reembolso / Pagamento / Linha / Contrato |
| TITULO            | Título do chamado                |
| STATUS            | aguardando / aprovado / fila / rejeitado |
| VALOR             | Valor em R$                      |
| SOLICITANTE       | Nome do solicitante              |
| EMAIL_SOLICITANTE | E-mail do solicitante            |
| AUTOR_EMAIL       | E-mail de quem abriu o chamado   |
| APROVADOR         | Aprovador responsável            |
| CENTRO_CUSTO      | Centro de custo                  |
| DT_ABERTURA       | Data de criação                  |
| DT_ATUALIZACAO    | Data da última mudança de status |
| VG_*, RB_*, PG_*, LT_*, CT_* | Metadados específicos por tipo |

## 7. Re-sincronizar um chamado manualmente

Se um chamado falhou ao gravar no Sankhya, use o endpoint:

```
POST /chamados/:id/sync-sankhya
Authorization: Bearer <token_admin>
```

O campo `sankhya = true` no banco indica que o chamado foi gravado com sucesso.
