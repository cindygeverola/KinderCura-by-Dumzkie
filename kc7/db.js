const sql = require('mssql');
require('dotenv').config();

const config = {
    server: 'CINDYGEVEROLA\\SQLEXPRESS02',
    database: 'KinderCura',
    user: 'sa',
    password: 'KinderCura@2024',
    options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true
    }
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('✅ Connected to SQL Server!');
        return pool;
    })
    .catch(err => {
        console.error('❌ Database connection failed:', err.message);
        throw err;
    });

module.exports = { sql, poolPromise };