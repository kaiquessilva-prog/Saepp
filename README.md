# SAEPVision

Galeria SPA em HTML/CSS/JavaScript com servidor Node.js e banco SQLite local. Não precisa instalar PHP, MySQL ou iniciar um serviço de banco.

## Requisitos

- Node.js 24 ou superior, com o módulo embutido `node:sqlite`.
- A pasta `anexos_prova/` ao lado da pasta do projeto para as fotos de exemplo e avatares originais.

## Iniciar

Abra o terminal nesta pasta do projeto e execute:

```powershell
npm start
```

Acesse http://127.0.0.1:8000/. Na primeira inicialização, o servidor cria `backend/data/saepvision.sqlite`, monta as tabelas e importa os usuários do CSV. A galeria inicial usa as nove fotografias fornecidas; uploads novos ficam em `assets/img/`.

Para encerrar, pressione `Ctrl+C` no terminal.

## Conta de teste

- Fotógrafo: `fotografo1@email.com`
- Senha inicial do CSV: `123456`

As senhas importadas são armazenadas com scrypt. O arquivo SQLite guarda usuários, publicações, curtidas e sessões.

## Criar conta

Na janela **Login**, escolha **Criar conta**. O formulário solicita nome completo, nome de usuário, e-mail, senha com pelo menos oito caracteres e tipo de conta (`Comum` ou `Fotógrafo`). Após o cadastro, a sessão é iniciada automaticamente; e-mails e nomes de usuário já existentes são rejeitados.
