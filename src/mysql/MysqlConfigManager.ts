import { Context } from '../ioc/Context';
import { MysqlClient } from './MysqlClient';
import { BaseSingletonDefinition } from '../ioc/objectdefinition/BaseSingletonDefinition';

export class MysqlConfigManager {
  static registerSingletons(context: Context) {
    if (!context.hasConfig('mysql')) {
      // No Mysql configured. Skipping
      return;
    }
    const confs = context.getConfig('mysql');
    Object.keys(confs).forEach((key) => {
      const clientSingleton = new BaseSingletonDefinition(MysqlClient, key);
      clientSingleton.setPropertyByValue('name', key);
      clientSingleton.setPropertyByValue('configuration', confs[key]);
      context.registerSingletons(clientSingleton);
    });
  }
}