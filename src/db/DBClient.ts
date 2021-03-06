import { createPool, Factory } from 'generic-pool';
import { Transaction } from '../transaction/TransactionManager';
import { LogManager } from '../log/LogManager';
import { DBTransaction } from './DBTransaction';
import { ConnectionPool, InstrumentedConnectionPool, ConnectionConfig, PoolConfig } from './ConnectionPool';

const LOGGER = LogManager.getLogger(__filename);

/**
 * Configuration for a DBClient, this includes master and slave connection pool configurations.
 * Only the master pool config is necessary, if a slave pool is specified, any readonly transactions will use it. If not,
 * all transactions will use the master connection pool.
 */
export interface DBClientConfig<C extends ConnectionConfig> {
  name: string,
  master: PoolConfig<C>,
  slave?: PoolConfig<C>,
}


export abstract class DBClient<C, T extends DBTransaction<C>, CC extends ConnectionConfig, PC extends DBClientConfig<CC>> {
  public static startMethod = 'initialise';
  public static stopMethod = 'stop';
  public clientConfiguration: PC;
  name: string;
  masterPool: ConnectionPool<C>;
  slavePool: ConnectionPool<C>;

  constructor(clientConfiguration: PC) {
    this.clientConfiguration = clientConfiguration;
  }

  abstract getNewDBTransaction(readonly: boolean, connectionPool: ConnectionPool<C>): T;

  abstract getDefaultConnectionConfig(): CC;

  /**
   * Runs a function in a transaction. The function must receive one parameter that will be of class
   * {MysqlTransaction} and that you need to use to run all queries in this transaction
   *
   * @param {boolean} readonly Whether the transaction needs to be readonly or not
   * @param {Function} func A function that returns a promise that will execute all the queries wanted in this transaction
   * @returns {Promise} A promise that will execute the whole transaction
   */
  async runInTransaction(readonly: boolean, func: (transaction: DBTransaction<C>) => Promise<any>): Promise<any> {
    const dbTransaction = this.getNewDBTransaction(readonly, this.getPoolForReadonly(readonly));
    try {
      await dbTransaction.begin();
      const resp = await func(dbTransaction);
      return resp;
    } catch (err) {
      LOGGER.error(err, 'There was an error running in transaction');
      dbTransaction.markError(err);
      throw err;
    } finally {
      await dbTransaction.end();
    }
  }

  getPoolForReadonly(readonly: boolean): ConnectionPool<C> {
    if (readonly && this.slavePool) {
      return this.slavePool;
    }
    return this.masterPool;
  }

  /**
   * Shorthand for a single readonly query
   * @param sql query to run
   * @param binds binds
   */
  async read<P>(sql: string, ...binds: any[]): Promise<P[]> {
    return this.executeSql(true, sql, ...binds);
  }

  /**
   * Shorthand to run a single sql.
   * Easy to mock
   * @param readonly
   * @param sql
   * @param binds
   */
  async executeSql(readonly: boolean, sql: string, ...binds: any[]): Promise<any> {
    return this.runInTransaction(readonly, (client) => client.query(sql, ...binds));
  }

  abstract getConnectionFactory(name: string, connectionConfig: CC): Factory<C>;

  async initialise() {
    const defaultConnectionConfig: CC = this.getDefaultConnectionConfig();
    if (this.clientConfiguration.master) {
      // tslint:disable-next-line:prefer-object-spread
      const fullMasterConfig: CC = Object.assign({}, defaultConnectionConfig, this.clientConfiguration.master.connectionConfig);
      this.masterPool = new InstrumentedConnectionPool<C, CC>(this.getConnectionFactory(`${this.clientConfiguration.name}_master`, fullMasterConfig), this.clientConfiguration.master, this.clientConfiguration.name, false);
      await this.masterPool.start();
    }
    if (this.clientConfiguration.slave) {
      // tslint:disable-next-line:prefer-object-spread
      const fullSlaveConfig: CC = Object.assign({}, defaultConnectionConfig, this.clientConfiguration.slave.connectionConfig);
      this.slavePool = new InstrumentedConnectionPool<C, CC>(this.getConnectionFactory(`${this.clientConfiguration.name}_slave`, fullSlaveConfig), this.clientConfiguration.slave, this.clientConfiguration.name, true);
      await this.slavePool.start();
    }
    if (!this.masterPool && !this.slavePool) {
      throw new Error(`MysqlClient ${this.name} has no connections configured for either master or slave`);
    }
  }

  async stop() {
    if (this.masterPool) {
      await this.masterPool.stop();
    }
    if (this.slavePool) {
      await this.slavePool.stop();
    }
  }

  async ping(readonly: boolean): Promise<void> {
    LOGGER.trace('Doing ping');
    const pool = this.getPoolForReadonly(readonly);
    const dbTransaction = this.getNewDBTransaction(true, pool);
    await dbTransaction.runQueryWithoutTransaction(this.getPingQuery());
  }

  abstract getPingQuery(): string;
}
