/**
 * Module de controle de cache
 * Este módulo pode:
 *  - fazer requisições na base de dados utilizando o DataBase (parent)
 *  - armazenar respostas na memória da máquina
 *  - buscar respostas na memória da máquina evitando requisições desnecessárias ao servidor;
 */

const sizeof = require("./sizeof");

module.exports = (parent, mainConfig)=>{

    const defaultConfig = {
        lifeTime: 1000 * 5, //tempo de vida da informação em cache
        minSize: 0, //tamanho mínimo da resposta para que seja armazenda em cache
        maxSize: 2 * 1000 * 1024, //tamanho máximo da resposta para que seja armazenada em cache: 2MB
        maxTotalSize: 20 * 1000 * 1024, //20MB
        callback: null, //funcção de callback a ser executada
        ifFresh: null, //função de callback para ser executada se o resposta for nova, ou seja, não estava em cache
        ifCache: null //função de callback para ser executada se a resposta vier da memória
    }

    const config = Object.assign(defaultConfig, mainConfig);

    //Resolve os callbacks a partir do cache
    const resolve = (key, callbackFunc)=>{
        let cacheReg = cache.get(key);

        //executa o callback da configuração
        if(typeof(cache.config.callback) == 'function'){
            cache.config.callback(cacheReg.response);
        }

        //Somente executa se a resposta vem do cache
        if(typeof(cache.config.isCache) == 'function'){
            cache.config.isCache(cacheReg.response);
        }

        //Executa o callback do parametro
        if(typeof(callbackFunc) == 'function'){
            callbackFunc(cacheReg.response);
        }
    }

    //Resolve os callbacks a partir da resposta da nova requisição
    const resolveRequest = (response, callbackFunc)=>{
        //executa o callback da configuração
        if(typeof(cache.config.callback) == 'function'){
            cache.config.callback(response);
        }

        //Somente executa se a resposta vem do cache
        if(typeof(cache.config.isFresh) == 'function'){
            cache.config.isFresh(response);
        }

        //Executa o callback do parametro
        if(typeof(callbackFunc) == 'function'){
            callbackFunc(response);
        }
    }

    const cache = {
        memory: {}, //{key: {expires, response, size}}
        config: config,

        clean: ()=>{
            cache.memory = {};
        },

        //Captura um determinado objeto na memória a partir da chave
        get: (key)=>{
            return cache.memory[key];
        },

        //retorna true se uma determinada chave estiver presente na memória
        has: (key)=>{
            return typeof(cache.memory[key]) != 'undefined'; 
        },

        //Remove um determinado objeto da memória
        remove: (key)=>{
            return delete cache.memory[key];
        },

        search: (tableName, term, callback)=>{

        },

        select: (tableName, where, limit, callback)=>{
            return cache.where(tableName, where, limit, callback);
        },

        //Retorna o tamanho do cache até o momento em bytes
        size: ()=>{
            let size = 0;
            
            for(let i in cache.memory){
                size += cache.memory[i].size;
            }

            return size;
        },

        where: (tableName, where, limit, callback)=>{
            let wherearr = [];
            let wherest = '';
            let limitst = '0';
            
            if(typeof(where) == 'object'){
                for(let i in where){
                    wherearr.push(i + '='+ where[i]);
                }

                wherest = wherearr.join('&');
            }

            if(typeof(limit) != 'undefined'){
                limitst = limit.toString();
            }

            //cria uma chave de query
            const cacheKey = 'SELECT$' + tableName + '$' + wherest + '$' + limitst;

            //pesquisar na memória por este cacheKey
            if(cache.has(cacheKey)){
                let cacheReg = cache.get(cacheKey);
                //verificar a validade deste registro
                if(cacheReg.expires >= Date.now()){
                    //Resolve todos os callbacks para uma chave de cache;
                    resolve(cacheKey, callback);

                    //Finaliza a chamada retornando o cache
                    return Promise.resolve(cacheReg.response);
                }
                else{
                    //Remove este objeto da memória pois ele ficou obsoleto
                    cache.remove(cacheKey);
                }
            }

            //Como não foi encontrado um objeto de cache válido vamos fazer uma nova requisição e armazenar a resposta
            //Mas antes vamos definir nossa função de callback
            const callbackFunc = (response)=>{
                //criando um novo registro para armazenar no cache
                const reg = {
                    key: cacheKey,
                    response: response,
                    expires: Date.now() + cache.config.lifeTime,
                    size: sizeof(response)
                };

                cache.memory[cacheKey] = reg;

                resolveRequest(response, callback);
            }

            return parent.where(tableName, where, limit, callbackFunc);
        }
    }

    return cache;
}