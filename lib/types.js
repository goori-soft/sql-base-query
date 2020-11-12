const arrOftypes = {
    numbers: ['INT', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT', 'NUMBER', 'BOOLEAN'],
    strings: ['STRING', 'CHAR', 'VARCHAR', 'TINYTEXT', 'TEXT', 'BLOB', 'MEDIUMTEXT', 'MEDIUMBLOB', 'LONGTEXT', 'LONGBLOB'],
    floats: ['FLOAT', 'DOUBLE', 'DECIMAL'],
    dates: ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME'],
}

const types = {};

for(let i in arrOftypes){
    let arr = arrOftypes[i];
    types[i] = arr;
    for(let index in arr){
        types[arr[index]] = arr[index];
    }
}

module.exports = types;