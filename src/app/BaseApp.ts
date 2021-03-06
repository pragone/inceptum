import { Context } from '../ioc/Context';
import { LogManager, Logger } from '../log/LogManager';
import { PreinstantiatedSingletonDefinition } from '../ioc/objectdefinition/PreinstantiatedSingletonDefinition';
import { LifecycleState } from '../ioc/Lifecycle';
import Config, { ConfigAdapter } from '../config/ConfigProvider';

export type PluginLifecycleMethodName = 'willStart' | 'didStart' | 'willStop' | 'didStop';
export type PluginLifecycleMethod = (app: BaseApp, pluginContext?: Map<String, any>) => Promise<void> | void;

export type PluginType = {
  [method in PluginLifecycleMethodName]: PluginLifecycleMethod;
};

export interface Plugin {
  name: string,
  willStart?: PluginLifecycleMethod,
  didStart?: PluginLifecycleMethod,
  willStop?: PluginLifecycleMethod,
  didStop?: PluginLifecycleMethod,
}

export interface PluginWithWillStart {
  willStart: PluginLifecycleMethod,
}

export interface PluginWithDidStart {
  didStart: PluginLifecycleMethod,
}

export interface PluginWithWillStop {
  willStop: PluginLifecycleMethod,
}

export interface PluginWithDidStop {
  didStop: PluginLifecycleMethod,
}

export interface PluginNameable {
  name: string,
}

export type PluginImplementsAtLeastOneMethod = PluginWithWillStart | PluginWithDidStart | PluginWithWillStop | PluginWithDidStop;
export type PluginImplemenation = PluginNameable & PluginImplementsAtLeastOneMethod;

export interface AppOptions {
  logger?: Logger,
  config?: ConfigAdapter,
}

export type PluginContext = Map<String | Symbol, any>;

export default class BaseApp {
  protected logger: Logger;
  protected context: Context;
  protected appName: string;

  protected plugins: PluginImplemenation[] = [];
  protected pluginContext: PluginContext = new Map();

  /**
   * Creates a new Inceptum App
   */
  constructor(options: AppOptions = {}) {
    const { config = new Config() } = options;
    const { logger = LogManager.getLogger(__filename) } = options;
    this.logger = logger;
    this.logger.info(`Using app name ${LogManager.getAppName()}`);
    this.context = new Context(config.getConfig('app.context.name', 'BaseContext'), null, options);
    this.context.registerDefinition(new PreinstantiatedSingletonDefinition(LogManager));
    this.context.registerDefinition(new PreinstantiatedSingletonDefinition(logger, 'logger'));
    this.context.on('STOPPED', () => LogManager.scheduleShutdown());
  }

  public use(...plugins: PluginImplemenation[]) {
    return this.register(...plugins);
  }


  /**
   * Register services or controllers with Inceptum
   * Note that we are using "npm globby" internally for glob matching.
   *
   * Globs are disabled by default. Pass isGlob=true to enable glob matching
   *
   * Globs will be automatically activated if the "patterns" parameter is an array of strings,
   * or if it contains magic characters (eg: * ? { })
   *
   * @param {string|Array<string>} patterns - path as a relative path or as glob pattern(s). See options for more details
   * @param {Object} [options] - options object for enabling and configuring glob matching
   * @param {boolean} [options.isGlob=false] - pass true to treat the path as a glob
   * @param {Object} [options.globOptions] - options to pass to globby
   */
  public addDirectory(patterns: string | Array<string>, options: {
    isGlob: boolean,
    globOptions: Object,
  } = {
    isGlob: false,
    globOptions: {},
  }) {
    return this.getContext().registerSingletonsInDir(patterns, options);
  }

  public register(...plugins: PluginImplemenation[]) {
    if (this.context.getStatus() !== LifecycleState.NOT_STARTED) {

      throw new Error(
        `Cannot register plugin(s) ${plugins
          .map((p) => p.name)
          .join(',')} as the app has already started. Please register all plugins before calling "start()"`,
      );
    }
    this.plugins = this.plugins.concat(plugins);
  }

  public getRegisteredPluginNames(): string[] {
    return this.plugins.map((plugin) => plugin.name);
  }

  public hasRegisteredPlugin(name: string): boolean {
    return !!this.plugins.find((plugin) => plugin.name === name);
  }

  private runLifecycleMethodOnPlugins(method: PluginLifecycleMethodName) {
    return this.plugins.reduce(async (previous, plugin) => {
      await previous;
      if (plugin[method]) {
        this.logger.debug(`${method}:${plugin.name}`);
        return plugin[method](this, this.pluginContext);
      }
      return Promise.resolve();
    }, Promise.resolve());
  }

  async start() {
    await this.runLifecycleMethodOnPlugins('willStart');
    process.on('SIGINT', () => {
      this.stop().then(() => process.exit());
    });
    process.on('SIGTERM', () => {
      this.stop().then(() => process.exit());
    });
    await this.context.lcStart();
    return this.runLifecycleMethodOnPlugins('didStart');
  }
  async stop() {
    await this.runLifecycleMethodOnPlugins('willStop');
    this.logger.info('Shutting down app');
    await this.context.lcStop();
    const r = await this.runLifecycleMethodOnPlugins('didStop');
    delete this.logger;
    return r;
  }

  getContext(): Context {
    return this.context;
  }
  // tslint:disable-next-line:prefer-function-over-method
  getConfig(key, defaultValue): any {
    return this.getContext().getConfig(key, defaultValue);
  }
  // tslint:disable-next-line:prefer-function-over-method
  hasConfig(key): boolean {
    return this.getContext().hasConfig(key);
  }
}
