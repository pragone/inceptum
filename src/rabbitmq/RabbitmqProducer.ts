import { connect, Connection, Channel } from 'amqplib';
import { Counter, Histogram } from 'prom-client';
import { LogManager } from '../log/LogManager';
import { RabbitmqProducerConfig, RabbitmqBackPressureStrategy, RabbitmqClientConfig } from './RabbitmqConfig';
import { PublishOptions, RabbitmqClient } from './RabbitmqClient';

const logger = LogManager.getLogger(__filename);

const rabbitmqPublishTime = new Histogram({
    name: 'rabbitmq_publish_time',
    help: 'Time required to publish messages to RabbitMQ',
    labelNames: ['name'],
    buckets: [0.001, 0.003, 0.005, 0.01, 0.05, 0.1, 0.3]});
const rabbitmqPublishErrorCounter = new Counter({
    name: 'rabbitmq_publish_error_counter',
    help: 'Number of errors encountered when publishing messages',
    labelNames: ['name'],
});


export class RabbitmqProducer extends RabbitmqClient {
    publishFailures: Counter.Internal;
    publishDurationHistogram: Histogram.Internal;
    protected producerConfig: RabbitmqProducerConfig;

    constructor(
        clientConfig: RabbitmqClientConfig,
        name: string,
        producerConfig: RabbitmqProducerConfig ) {
            super(clientConfig, name);
            this.producerConfig = {...producerConfig};
            this.producerConfig.backPressureStrategy = producerConfig.backPressureStrategy || RabbitmqBackPressureStrategy.ERROR;
            this.logger = logger;
            this.publishDurationHistogram = rabbitmqPublishTime.labels(name);
            this.publishFailures = rabbitmqPublishErrorCounter.labels(name);
    }

    /**
     * publish msg with routing key
     * @param msg
     * @param routingKey
     */
    async publish(msg: string, routingKey: string, optionsPublish: PublishOptions = {}): Promise<boolean> {
        if (this.closed) {
            throw new Error('Connection to RabbitMQ is closed, can\'t publish message');
        }
        if (!this.readyGate.isChannelReady()) {
            await this.readyGate.awaitChannelReady();
        }
        optionsPublish.headers = {
            retriesCount: 0,
        };
        const timer = this.publishDurationHistogram.startTimer();
        try {
            while (!this.channel.publish(this.producerConfig.exchangeName, routingKey, new Buffer(msg), optionsPublish)) {
                if (this.producerConfig.backPressureStrategy === RabbitmqBackPressureStrategy.ERROR) {
                    throw new Error('Failed to publish message');
                }
                if (optionsPublish.headers.retriesCount >= 3) {
                    throw new Error('Failed to publish message after 3 attempts');
                }

                this.publishFailures.inc();
                optionsPublish.headers.retriesCount++;

                this.logger.error(`publish failed. ====> ${msg}`);
                await new Promise<void>((resolve: () => void, reject: () => void) => {
                    this.channel.once('drain', function() {
                        this.logger.info(`drain event received. ====> ${msg}`);
                        resolve();
                    });
                });
            }
        } finally {
            timer();
        }

        return true;
    }

    init(): Promise<void> {
        return super.init();
    }

    close(): Promise<void> {
        return super.close();
    }
}
