import 'reflect-metadata';

export const INCEPTUM_METADATA_KEY = 'inceptum';

export class InceptumMetadata {
  autowire = new Map<string, string>();
  lazy = true;
  startMethod: string = null;
  stopMethod: string = null;
}

export function hasDecoratorMetadata(target: any): boolean {
  return Reflect.hasMetadata(INCEPTUM_METADATA_KEY, target);
}

export function getDecoratorMetadata(target: any): InceptumMetadata {
  return Reflect.getMetadata(INCEPTUM_METADATA_KEY, target);
}

function getOrCreateMetadata(target: any): InceptumMetadata {
  if (hasDecoratorMetadata(target)) {
    return getDecoratorMetadata(target);
  }
  const metadata = new InceptumMetadata();
  Reflect.defineMetadata(INCEPTUM_METADATA_KEY, metadata, target);
  return metadata;
}

export function Autowire(what: string) {
  return (target: any, key: string) => {
    // console.log('Called Autowire');
    const metadata = getOrCreateMetadata(target);
    metadata.autowire.set(key, what);
  };
}

export function AutowireConfig(configKey: string) {
  return (target: any, key: string) => {
    // console.log('Called Autowire');
    const metadata = getOrCreateMetadata(target);
    metadata.autowire.set(key, `#${configKey}`);
  };
}

export function Lazy(lazy: boolean) {
  return (target) => {
    const metadata = getOrCreateMetadata(target.prototype);
    metadata.lazy = lazy;
  };
}

export function StartMethod(target, key: string) {
  const metadata = getOrCreateMetadata(target);
  metadata.startMethod = key;
}

export function StopMethod(target, key: string) {
  const metadata = getOrCreateMetadata(target);
  metadata.stopMethod = key;
}
