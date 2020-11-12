/**
 * Arquivo de configuração de conexão com a base de dados.
 * Este arquivo carrega as variáveis setadas no arquivo .env em ambiente de desenvolvimento
 * Em ambiente de produção ele carrega as variaveis setadas diretamente no servidor.
 * 
 * No caso de servidores Loadbalacers AWS verifique as configurações do ambiente.
 * 
 * IPORTANTE: De modo geral este arquivo não requer refaturamento, caso haja algum problema com a conexão
 * entre o servidor e a base de dados, seja em modo de desenvolvimento ou produção, verifique tanto o arquivo
 * .env (na raiz da aplicação) quanto as variaveis de ambiente setadas diretamente no servidor. Outro ponto
 * importante que pode causar erros no caso de conexão com a base RDS AWS pode estar relacionada aos grupos
 * de segurança setados no servicço EC2 (procure por 'EC2 >> security groups');
 */

if(process.env.NODE_ENV !== 'production'){
    require('dotenv/config');
}

var config = {
    host: process.env.DATABASE_HOST ? process.env.DATABASE_HOST : 'localhost',
    port: process.env.DATABASE_PORT ? process.env.DATABASE_PORT : '3306',
    database: process.env.DATABASE_NAME ? process.env.DATABASE_NAME : null,
    user: process.env.DATABASE_USER ? process.env.DATABASE_USER : 'root',
    password: process.env.DATABASE_PASS ? process.env.DATABASE_PASS : '',

    test: process.env.DATABASE_TEST ? process.env.DATABASE_TEST : true,
    reconnect: process.env.DATABASE_RECONNECT ? process.env.DATABASE_RECONNECT : false,
    reconnectTime: process.env.DATABASE_RECONNECT_TIME ? process.env.DATABASE_RECONNECT_TIME : 5,
}

module.exports = config;