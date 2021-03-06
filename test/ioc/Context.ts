// Test...
import { must } from 'must';
import { suite, test, slow, timeout, skip } from 'mocha-typescript';
import { mock } from 'ts-mockito';
import * as mockFS from 'mock-fs';

import { Context } from '../../src/ioc/Context';
import { Lifecycle, LifecycleState } from '../../src/ioc/Lifecycle';
import { BaseSingletonDefinition } from '../../src/ioc/objectdefinition/BaseSingletonDefinition';
import { PromiseUtil } from '../../src/util/PromiseUtil';
import { LogManager } from '../../src/log/LogManager';
const logger = LogManager.getLogger();

class A {
  private val;
  constructor(val) {
    // console.log('Instantiating A');
    this.val = val;
  }
}

class B {
  a;
  constructor(a) {
    // console.log('Instantiating B');
    this.a = a;
  }
  shutdown() {
    // console.log('Shutting down instance of B');
  }
  delayedStart() {
    logger.info('Starting delayed start');
    return new Promise((resolve) => {
      setTimeout(() => { logger.info('Delaya done'); resolve(); }, 10);
    });
  }
}

class TrackSingleton {
  private static initialised;

  static clear() {
    TrackSingleton.initialised = false;
  }
  static mark() {
    TrackSingleton.initialised = true;
  }
  static isInitialised() {
    return TrackSingleton.initialised;
  }
  constructor() {
    TrackSingleton.mark();
  }
}
TrackSingleton.clear();

class ThrowOnInstantiate {
  constructor() {
    throw new Error('Exception instantiating');
  }
}

suite('ioc/Context', () => {
  suite('inheritance', () => {
    test('starting the child context starts the parent context', () => {
      const parentContext = new Context('parent context');
      const childContext = new Context('child context', parentContext);
      return childContext.lcStart()
        .then(() => {
          childContext.getStatus().must.be.equal(LifecycleState.STARTED);
          parentContext.getStatus().must.be.equal(LifecycleState.STARTED);
        })
        .then(() => childContext.lcStop());
    });
    test('stopping the child context stops the parent context', () => {
      const parentContext = new Context('parent context');
      const childContext = new Context('child context', parentContext);
      return childContext.lcStart()
        .then(() => childContext.lcStop())
        .then(() => {
          childContext.getStatus().must.be.equal(LifecycleState.STOPPED);
          parentContext.getStatus().must.be.equal(LifecycleState.STOPPED);
        });
    });
    test('Parent objects are available in the child context', () => {
      const parentContext = new Context('parent context');
      parentContext.registerSingletons(A);
      const childContext = new Context('child context', parentContext);
      return childContext.lcStart()
        .then(() => childContext.getObjectByName('A'))
        .then((a) => {
          a.must.not.be.falsy();
          a.must.be.instanceOf(A);
        })
        .then(() => childContext.lcStop());
    });
  });
  suite('Lazyness', () => {
    test('lazy objects are not initialised during context start', () => {
      TrackSingleton.clear();
      const myContext = new Context('test1');
      myContext.registerSingletons(TrackSingleton);
      return myContext.lcStart()
        .then(() => {
          TrackSingleton.isInitialised().must.be.false();
        })
        .then(() => myContext.lcStop());
    });
    test('non-lazy objects are initialised during context start', () => {
      TrackSingleton.clear();
      const myContext = new Context('test1');
      myContext.registerSingletons(TrackSingleton);
      myContext.getDefinitionByName('TrackSingleton').withLazyLoading(false);
      return myContext.lcStart()
        .then(() => {
          TrackSingleton.isInitialised().must.be.true();
        })
        .then(() => myContext.lcStop());
    });
    test('an exception during the initialisation of a non-lazy object cancels the context initialisation', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(ThrowOnInstantiate);
      myContext.getDefinitionByName('ThrowOnInstantiate').withLazyLoading(false);
      return myContext.lcStart()
        .then(() => {
          true.must.be.false();
        })
        .catch((e) => {
          e.must.be.an.error('Exception instantiating');
        });
    });
  });
  suite('register singleton validations', () => {
    test('can\'t register an object definition that is not one', () => {
      const myContext = new Context('test1');
      try {
        myContext.registerDefinition('not an object definition' as any);
          true.must.be.false();
      } catch (e) {
        e.must.be.an.error('Provided input for registration is not an instance of ObjectDefinition');
      }
    });
    test('can\'t register an object definition if one by the same name already exists', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      try {
        myContext.registerSingletons(A);
        true.must.be.false();
      } catch (e) {
        e.must.be.an.error('Object definition with name A already exists in this context');
      }
    });
  });
  suite('individual bean options', () => {
    test('can get a bean', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      return myContext.lcStart()
        .then(() => myContext.getObjectByName('A'))
        .then((obj) => {
          (obj === undefined).must.be.false();
        })
        .then(() => myContext.lcStop());
    });
    test('can get a bean by type', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      return myContext.lcStart()
        .then(() => myContext.getObjectByType('A'))
        .then((obj) => {
          (obj === undefined).must.be.false();
        })
        .then(() => myContext.lcStop());
    });
    test('can get a bean by type multi', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      return myContext.lcStart()
        .then(() => myContext.getObjectsByType('A'))
        .then((obj) => {
          obj.must.be.array();
          obj.length.must.be.equal(1);
        })
        .then(() => myContext.lcStop());
    });
    test('the bean is a singleton', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      return myContext.lcStart()
        .then(() => myContext.getObjectByType('A'))
        .then((obj) => {
          obj.val = 15;
        })
        .then(() => myContext.getObjectByType('A'))
        .then((obj) => {
          obj.val.must.be.equal(15);
        })
        .then(() => myContext.lcStop());
    });
  });
  suite('object with constructor args', () => {
    test('can use value constructor arguments', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByValue('the value'));
      return myContext.lcStart()
        .then(() => myContext.getObjectByName('A'))
        .then((a) => {
          (a === undefined).must.be.false();
          (a.val).must.be.equal('the value');
        })
        .then(() => myContext.lcStop());
    });
    test('can use reference constructor arguments', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByValue('the value'));
      myContext.registerSingletons(new BaseSingletonDefinition(B).constructorParamByRef('A'));
      return myContext.lcStart()
        .then(() => PromiseUtil.mapSeries(['A', 'B'], (l) => myContext.getObjectByName(l)))
        .then(([a, b]) => {
          (a === undefined).must.be.false();
          (b === undefined).must.be.false();
          b.a.must.be.equal(a);
        })
        .then(() => myContext.lcStop());
    });
    test('can use type constructor arguments', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByValue('the value'));
      myContext.registerSingletons(new BaseSingletonDefinition(B).constructorParamByType('A'));
      return myContext.lcStart()
        .then(() => PromiseUtil.mapSeries(['A', 'B'], (l) => myContext.getObjectByName(l)))
        .then((arr) => {
          const a = arr[0];
          const b = arr[1];
          (a === undefined).must.be.false();
          (b === undefined).must.be.false();
          b.a.must.be.equal(a);
        })
        .then(() => myContext.lcStop());
    });
  });
  suite('getting objects', () => {
    test('getting by name', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      return myContext.lcStart()
        .then(() => myContext.getObjectByName('A'))
        .then((a) => {
          (a === undefined).must.be.false();
          a.must.be.an.instanceOf(A);
        })
        .then(() => myContext.lcStop());
    });
    test('getting by type', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      return myContext.lcStart()
        .then(() => myContext.getObjectByType('A'))
        .then((a) => {
          (a === undefined).must.be.false();
          a.must.be.an.instanceOf(A);
        })
        .then(() => myContext.lcStop());
    });
    test('getting by type array', async () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      await myContext.lcStart();
      const a  = await myContext.getObjectsByType('A');
      (a === undefined).must.be.false();
      a.must.be.an.array();
      a.length.must.be.equal(1);
      a[0].must.be.an.instanceOf(A);
      await myContext.lcStop();
    });
  });
  suite('getting object definitions', () => {
    test('getting by name', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      const a = myContext.getDefinitionByName('A');
      (a === undefined).must.be.false();
      a.must.be.an.instanceOf(BaseSingletonDefinition);
    });
    test('getting by type', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      const a = myContext.getDefinitionByType('A');
      (a === undefined).must.be.false();
      a.must.be.an.instanceOf(BaseSingletonDefinition);
    });
    test('getting by type array', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      myContext.registerSingletons(new BaseSingletonDefinition(A, 'A2'));
      const a = myContext.getDefinitionsByType('A');
      (a === undefined).must.be.false();
      a.must.be.an.array();
      a.length.must.equal(2);
      a[0].must.be.an.instanceOf(BaseSingletonDefinition);
      a[0].getProducedClass().must.equal(A);
      (a[0].getName() === 'A' || a[0].getName() === 'A2').must.be.true();
      a[1].must.be.an.instanceOf(BaseSingletonDefinition);
      a[1].getProducedClass().must.equal(A);
      (a[1].getName() === 'A' || a[1].getName() === 'A2').must.be.true();
    });
    test('getting by group', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(A);
      myContext.registerSingletons(new BaseSingletonDefinition(A, 'A2'));
      myContext.addObjectNameToGroup('myGroup', 'A');

      const a = myContext.getDefinitionsByGroup('myGroup');
      (a === undefined).must.be.false();
      a.must.be.an.array();
      a.length.must.equal(1);
      a[0].must.be.an.instanceOf(BaseSingletonDefinition);
      a[0].getProducedClass().must.equal(A);
      a[0].getName().must.equal('A');
    });
  });
  suite('objects with constructors set', () => {
    test('can use groups in constructor', async () => {
      const myContext = new Context('test1');

      myContext.registerSingletons(new BaseSingletonDefinition(A, 'A1').constructorParamByValue('val1'));
      myContext.registerSingletons(new BaseSingletonDefinition(A, 'A2').constructorParamByValue('val2'));
      myContext.addObjectNameToGroup('myGroup', 'A1');
      myContext.addObjectNameToGroup('myGroup', 'A2');
      myContext.registerSingletons(new BaseSingletonDefinition(B).constructorParamByGroup('myGroup'));

      await myContext.lcStart();
      const b: B = await myContext.getObjectByName('B');
      b.a.must.be.an.array();
      b.a.length.must.equal(2);
      const values: string[] = b.a.map((a) => a.val);
      values.sort();
      values.must.eql(['val1', 'val2']);
      await myContext.lcStop();
    });
  });
  suite('objects with parameters set', () => {
    test('can use value params', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A).setPropertyByValue('val', 'the value'));
      return myContext.lcStart()
        .then(() => myContext.getObjectByName('A'))
        .then((a) => {
          (a === undefined).must.be.false();
          (a.val === undefined).must.be.false();
          a.val.must.be.equal('the value');
        })
        .then(() => myContext.lcStop());
    });
    test('can use reference params', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByValue('the value'));
      myContext.registerSingletons(new BaseSingletonDefinition(B).setPropertyByRef('a', 'A'));
      return myContext.lcStart()
        .then(() => PromiseUtil.mapSeries(['A', 'B'], (n) => myContext.getObjectByName(n)))
        .then(([a, b]) => {
          (a === undefined).must.be.false();
          (b === undefined).must.be.false();
          (b.a === undefined).must.be.false();
          b.a.must.be.equal(a);
        })
        .then(() => myContext.lcStop());
    });
    test('can use type params', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByValue('the value'));
      myContext.registerSingletons(new BaseSingletonDefinition(B).setPropertyByType('a', 'A'));
      return myContext.lcStart()
        .then(() => PromiseUtil.mapSeries(['A', 'B'], (n) => myContext.getObjectByName(n)))
        .then(([a, b]) => {
          (a === undefined).must.be.false();
          (b === undefined).must.be.false();
          (b.a === undefined).must.be.false();
          b.a.must.be.equal(a);
        })
        .then(() => myContext.lcStop());
    });
    test('can use group params', async () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A));
      myContext.registerSingletons(new BaseSingletonDefinition(B).setPropertyByGroup('a', 'myGroup'));
      myContext.addObjectNameToGroup('myGroup', 'A');
      await myContext.lcStart();
      const b: B = await myContext.getObjectByName('B');
      (b === undefined).must.be.false();
      (b.a === undefined).must.be.false();
      b.a.must.be.an.array();
      b.a.length.must.equal(1);
      (b.a[0] instanceof A).must.be.true();
      await myContext.lcStop();
    });
    test('can use definition group params', async () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A));
      myContext.registerSingletons(new BaseSingletonDefinition(B).setPropertyByDefinitionGroup('a', 'myGroup'));
      myContext.addObjectNameToGroup('myGroup', 'A');
      await myContext.lcStart();
      const b: B = await myContext.getObjectByName('B');
      (b === undefined).must.be.false();
      (b.a === undefined).must.be.false();
      b.a.must.be.an.array();
      b.a.length.must.equal(1);
      (b.a[0] instanceof BaseSingletonDefinition).must.be.true();
      (b.a[0] as any as BaseSingletonDefinition<any>).getName().must.equal('A');
      await myContext.lcStop();
    });
  });
  suite('wiring', () => {
    test('can manage circular dependencies', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition<A>(A).constructorParamByRef('B'));
      myContext.registerSingletons(new BaseSingletonDefinition<B>(B).setPropertyByRef('a', 'A'));
      return myContext.lcStart()
        .then(() => PromiseUtil.map(['A', 'B'], (n) => myContext.getObjectByName(n)))
        .then(([a, b]) => {
          (a === undefined).must.be.false();
          (b === undefined).must.be.false();
          (a.val === undefined).must.be.false();
          a.val.must.be.equal(b);
          return [a, b];
        })
        .then((v) => PromiseUtil.sleepPromise<any>(20, v))
        .then(([a, b]) => {
          b.a.must.be.equal(a);
        })
        .then(() => myContext.lcStop());
    });
    test('can manage diamond dependencies', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(B).startFunction('delayedStart'));
      myContext.registerSingletons(new BaseSingletonDefinition(A, 'A1').setPropertyByRef('b', 'B'));
      myContext.registerSingletons(new BaseSingletonDefinition(A, 'A2').setPropertyByRef('b', 'B'));
      myContext.registerSingletons(new BaseSingletonDefinition(A, 'Final').setPropertyByRef('a1', 'A1').setPropertyByRef('a2', 'A2'));
      return myContext.lcStart()
        .then(() => myContext.getObjectByName('Final'))
        .then((final) => PromiseUtil.sleepPromise(50, final))
        .then((final) => {
          (final === undefined).must.be.false();
          (final.a1 === undefined).must.be.false();
          (final.a2 === undefined).must.be.false();
          (final.a1.b === undefined).must.be.false();
          (final.a2.b === undefined).must.be.false();
          final.a1.b.must.be.equal(final.a2.b);
        })
        .then(() => myContext.lcStop(), (err) => {
          myContext.lcStop();
          throw err;
        });
    });
    test('throws an exception when the circular dependency is in the constructor', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByRef('B'));
      myContext.registerSingletons(new BaseSingletonDefinition(B).constructorParamByRef('A'));

      return myContext.lcStart()
        .then(() => myContext.getObjectByName('A'))
        .then(() => {
          throw new Error('Shouldn\'t be here');
        })
        .catch((err) => {
          err.must.be.an.error(/Circular dependency detected/);
        })
        .then(() => myContext.lcStop());
    });
  });
  suite('cloning', () => {
    test('throws an exception when in any state other than NOT_STARTED', () => {
      const myContext = new Context('test1');
      return myContext.lcStart()
        .then(() => myContext.clone('copy'))
        .catch((err) => err.must.be.an.error(/Operation requires state to be/))
        .then(() => myContext.lcStop());
    });
    test('clones all object definitions', () => {
      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByValue('the value'));

      const clonedContext = myContext.clone('test2');

      return myContext.lcStart()
        .then(() => clonedContext.lcStart())
        .then(() => PromiseUtil.mapSeries([myContext, clonedContext], (c) => c.getObjectByName('A')))
        .then(([a, copyA]) => {
          (a === undefined).must.be.false();
          (copyA === undefined).must.be.false();
          copyA.must.be.an.instanceOf(A);
          a.val.must.be.equal(copyA.val);
        })
        .then(() => Promise.all([myContext.lcStop(), clonedContext.lcStop()]));
    });
  });
  suite('importContext', () => {
    test('throws an exception when in any state other than NOT_STARTED', () => {
      const myContext = new Context('test1');
      const otherContext = new Context('other_context');

      return myContext.lcStart()
        .then(() => myContext.importContext(otherContext))
        .catch((e) => e.must.be.an.error(/Operation requires state to be/))
        .then(() => myContext.lcStop());
    });
    test('copies new object definitions into current context', () => {
      const otherContext = new Context('other_context');
      otherContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByValue('the value'));

      const myContext = new Context('test1');
      myContext.importContext(otherContext);

      return myContext.lcStart()
        .then(() => otherContext.lcStart())
        .then(() => myContext.getObjectByName('A'))
        .then((a) => {
          (a === undefined).must.be.false();
          a.val.must.be.equal('the value');
        })
        .then(() => myContext.lcStop())
        .then(() => otherContext.lcStop());
    });
    test('overwrites an object definition in the current context', () => {
      const otherContext = new Context('other_context');
      otherContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByValue('X'));

      const myContext = new Context('test1');
      myContext.registerSingletons(new BaseSingletonDefinition(A).constructorParamByValue('A'));

      myContext.importContext(otherContext, true);

      return myContext.lcStart()
        .then(() => otherContext.lcStart())
        .then(() => myContext.getObjectByName('A'))
        .then((a) => {
          (a === undefined).must.be.false();
          a.val.must.be.equal('X');
        })
        .then(() => myContext.lcStop())
        .then(() => otherContext.lcStop());
    });
  });
  suite('findMatchingFiles', () => {

    const options = {
      isGlob: false,
      globOptions: {},
    };

    beforeEach(() => {
      mockFS({
        src: {
          modules: {
            job: {
              __tests__: {
                'jobController.test.js': '',
                'jobView.test.js': '',
                'jobModel.test.js': '',
              },
              'jobController.js': '',
              'jobView.js': '',
              'jobModel.js': '',
              'configs.js': '',
            },
            message: {
              __tests__: {
                'messageController.test.js': '',
                'messageView.test.js': '',
                'messageModel.test.js': '',
              },
              'messageController.js': '',
              'messageView.js': '',
              'messageModel.js': '',
              'configs.js': '',
            },
            payment: {
              __tests__: {
                'paymentController.test.js': '',
                'paymentView.test.js': '',
                'paymentModel.test.js': '',
              },
              'paymentController.js': '',
              'paymentView.js': '',
              'paymentModel.js': '',
              'configs.js': '',
            },
          },
          controllers: {
            __tests__: {
              'jobController.test.js': '',
              'messageController.test.js': '',
              'paymentController.test.js': '',
            },
            'jobController.js': '',
            'messageController.js': '',
            'paymentController.js': '',
          },
          services: {
            subServices: {
              'repeatJobService.js': '',
            },
            'jobService.js': '',
          },
        },
        'eslintrc.json': '',
      });
    });

    afterEach(() => {
      mockFS.restore();
    });

    test('recursively matches files, given a simple path', () => {
      const files = Context.findMatchingFiles('src/services', options);
      [
        'src/services/jobService.js',
        'src/services/subServices/repeatJobService.js',
      ].forEach((expectedFile) => {
        files.must.include(expectedFile);
      });
    });
    test('ignores a directory decorated with negation', () => {
      const files = Context.findMatchingFiles(['src/controllers', '!src/controllers/__tests__'], options);
      [
        'src/controllers/jobController.js',
        'src/controllers/messageController.js',
        'src/controllers/paymentController.js',
      ].forEach((expectedFile) => {
        files.must.include(expectedFile);
      });
    });
    test('only matches files for glob pattern', () => {
      const files = Context.findMatchingFiles('src/modules/**/*Controller.js', options);
      [
        'src/modules/job/jobController.js',
        'src/modules/message/messageController.js',
        'src/modules/payment/paymentController.js',
      ].forEach((expectedFile) => {
        files.must.include(expectedFile);
      });
    });
    test('recursively match glob pattern', () => {
      const files = Context.findMatchingFiles(['src/**/*.js', '!src/**/*.test.js'], options);
      [
        'src/services/jobService.js',
        'src/services/subServices/repeatJobService.js',
        'src/controllers/jobController.js',
        'src/controllers/messageController.js',
        'src/controllers/paymentController.js',
        'src/modules/job/jobController.js',
        'src/modules/job/jobView.js',
        'src/modules/job/jobModel.js',
        'src/modules/job/configs.js',
        'src/modules/message/messageController.js',
        'src/modules/message/messageView.js',
        'src/modules/message/messageModel.js',
        'src/modules/message/configs.js',
        'src/modules/payment/paymentController.js',
        'src/modules/payment/paymentView.js',
        'src/modules/payment/paymentModel.js',
        'src/modules/payment/configs.js',
      ].forEach((expectedFile) => {
        files.must.include(expectedFile);
      });
    });

  });
});
