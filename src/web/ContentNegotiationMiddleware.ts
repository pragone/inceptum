import * as xmlbuilder from 'xmlbuilder';

/**
 * To use this middleware with swagger, set xml root tag name in relevant definition in swagger.yml
 */
export class ContentNegotiationMiddleware {
  private xmlRoot: string;

  constructor(xmlRoot: string) {
    this.xmlRoot = xmlRoot;
  }

  getMiddleware() {
    const xmlRoot = this.xmlRoot;
    if (!xmlRoot) {
      return;
    }
    return (req, res, next) => {
      const xmlType = 'application/xml';
      if (xmlType === req.get('accept')) {
        const originalSend = res.send;
        res.send = function(...data) {
          const obj = {};
          obj[xmlRoot] = data[0];
          data[0] = xmlbuilder.create(obj).end();
          originalSend.apply(res, data);
        };
        res.header('content-type', xmlType);
      }
      next();
    };
  }
}
