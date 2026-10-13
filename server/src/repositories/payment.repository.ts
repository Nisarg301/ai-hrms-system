import { PaymentModel, IPayment } from '../models/payment.model';
import { BaseRepository } from './base.repository';

export class PaymentRepository extends BaseRepository<IPayment> {
  constructor() {
    super(PaymentModel);
  }
}

export const paymentRepository = new PaymentRepository();
