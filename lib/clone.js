/**
 * clone an object in a deep level
 */

class CloneLib{
    lib = [];

    constructor(){
        //nothing to do here
    }

    getClone = (obj)=>{
        let lib =  this.lib.find((el)=>{
            return el.obj == obj;
        });

        if(typeof(lib) == 'object'){
            return lib.cloneObj;
        }

        return null;
    }

    includes = (obj)=>{
        let lib =  this.lib.find((el)=>{
            return el.obj == obj;
        });

        if(typeof(lib) == 'object'){
            return true;
        }

        return false;
    }

    push = (obj, cloneObj)=>{

        let lib = {
            obj,
            cloneObj
        }

        this.lib.push(lib);
        return this;
    }
}

const clone = function(obj, avoid){
    let cloneObj = {};
    if(typeof(obj) != 'object') return obj;
    if(Array.isArray(obj)) cloneObj = [];

    avoid = avoid || new CloneLib();
    if(!avoid.includes(obj)) avoid.push(obj, cloneObj);

    for(let i in obj){
        if(!avoid.includes(obj[i])){
            if(typeof(obj[i]) == 'object' && obj[i] != null){
                cloneObj[i] = clone(obj[i], avoid);
            }
            else if(typeof(obj[i]) == 'function'){
                cloneObj[i] = obj[i];
                cloneObj[i].bind(cloneObj);
            }
            else{
                cloneObj[i] = obj[i];
            }
        }
        else{
            cloneObj[i] = avoid.getClone(obj[i]);
        }
    }

    return cloneObj;
}

module.exports = clone;