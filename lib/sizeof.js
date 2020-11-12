/**
 * retorna o tamanho aproximado de um em bytes na memóra
 * @param {Any} object 
 */

module.exports = (object)=>{
    const objectList = [];
    const stack = [ object ];
    let bytes = 0;

    while ( stack.length ) {
        let value = stack.pop();

        if (typeof(value) === 'boolean') {
            bytes += 4;
        }
        else if (typeof(value) === 'string') {
            bytes += value.length * 2;
        }
        else if (typeof(value) === 'number') {
            bytes += 8;
        }
        else if(typeof (value) === 'object' && objectList.indexOf(value) === -1)
        {
            objectList.push(value);
            for(let i in value) {
                if(value.hasOwnProperty(i)){
                    stack.push(value[i]);
                    stack.push(i);
                }
            }
        }
    }

    return bytes;
}