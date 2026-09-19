import { Model, DataTypes, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';

interface CrmContractReceiptAttributes {
  id: number;
  contractId: number;
  receiptNumber: string;
  paymentNumber: string;
  paymentStructure: 'full' | 'installment' | 'milestone';
  paymentType: string | null;
  totalAmount: number;
  amount: number | null;
  paidAmount: number;
  remainingBalance: number;
  balanceAmount: number | null;
  currency: string;
  exchangeRateToAed: number;
  paymentMethod: string;
  transactionId: string | null;
  paymentDate: Date;
  status: 'pending' | 'processing' | 'completed' | 'paid' | 'failed' | 'refunded';
  dueDate: Date | null;
  installmentNumber: number | null;
  totalInstallments: number | null;
  milestoneName: string | null;
  gateway: string | null;
  gatewayTransactionId: string | null;
  receiptUrl: string | null;
  description: string | null;
  receiptType: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  clientAddress: string | null;
  serviceName: string | null;
  branchName: string | null;
  consultantName: string | null;
  taxAmount: number | null;
  discountAmount: number | null;
  notes: string | null;
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
  accountantStatus: string | null;
  accountantRemarks: string | null;
  accountantId: number | null;
  accountantVerifiedAt: Date | null;
}

interface CrmContractReceiptCreationAttributes extends Optional<CrmContractReceiptAttributes, 'id' | 'paymentType' | 'amount' | 'balanceAmount' | 'currency' | 'exchangeRateToAed' | 'transactionId' | 'dueDate' | 'installmentNumber' | 'totalInstallments' | 'milestoneName' | 'gateway' | 'gatewayTransactionId' | 'receiptUrl' | 'description' | 'receiptType' | 'clientName' | 'clientEmail' | 'clientPhone' | 'clientAddress' | 'serviceName' | 'branchName' | 'consultantName' | 'taxAmount' | 'discountAmount' | 'notes' | 'createdAt' | 'updatedAt' | 'accountantStatus' | 'accountantRemarks' | 'accountantId' | 'accountantVerifiedAt'> {}

class CrmContractReceipt extends Model<CrmContractReceiptAttributes, CrmContractReceiptCreationAttributes> implements CrmContractReceiptAttributes {
  declare id: number;
  declare contractId: number;
  declare receiptNumber: string;
  declare paymentNumber: string;
  declare paymentStructure: 'full' | 'installment' | 'milestone';
  declare paymentType: string | null;
  declare totalAmount: number;
  declare amount: number | null;
  declare paidAmount: number;
  declare remainingBalance: number;
  declare balanceAmount: number | null;
  declare currency: string;
  declare exchangeRateToAed: number;
  declare paymentMethod: string;
  declare transactionId: string | null;
  declare paymentDate: Date;
  declare status: 'pending' | 'processing' | 'completed' | 'paid' | 'failed' | 'refunded';
  declare dueDate: Date | null;
  declare installmentNumber: number | null;
  declare totalInstallments: number | null;
  declare milestoneName: string | null;
  declare gateway: string | null;
  declare gatewayTransactionId: string | null;
  declare receiptUrl: string | null;
  declare description: string | null;
  declare receiptType: string | null;
  declare clientName: string | null;
  declare clientEmail: string | null;
  declare clientPhone: string | null;
  declare clientAddress: string | null;
  declare serviceName: string | null;
  declare branchName: string | null;
  declare consultantName: string | null;
  declare taxAmount: number | null;
  declare discountAmount: number | null;
  declare notes: string | null;
  declare createdBy: number;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare accountantStatus: string | null;
  declare accountantRemarks: string | null;
  declare accountantId: number | null;
  declare accountantVerifiedAt: Date | null;

  public static associate(models: any) {
    CrmContractReceipt.belongsTo(models.CrmContract, { foreignKey: 'contract_id', targetKey: 'id', as: 'contract' });
    CrmContractReceipt.belongsTo(models.CrmEmployee, { foreignKey: 'created_by', targetKey: 'id', as: 'createdEmployee' });
    CrmContractReceipt.belongsTo(models.CrmEmployee, { foreignKey: 'accountant_id', targetKey: 'id', as: 'accountant' });
  }
}

CrmContractReceipt.init(
  {
    id: { type: DataTypes.INTEGER, allowNull: false, primaryKey: true, autoIncrement: true, field: 'id' },
    contractId: { type: DataTypes.INTEGER, allowNull: false, field: 'contract_id', references: { model: 'crm_contracts', key: 'id' } },
    receiptNumber: { type: DataTypes.STRING(50), allowNull: false, unique: true, field: 'receipt_number' },
    paymentNumber: { type: DataTypes.STRING(50), allowNull: false, unique: true, field: 'payment_number' },
    paymentStructure: { type: DataTypes.ENUM('full', 'installment', 'milestone'), allowNull: false, defaultValue: 'full', field: 'payment_structure' },
    paymentType: { type: DataTypes.STRING(100), allowNull: true, field: 'payment_type' },
    totalAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'total_amount' },
    amount: { type: DataTypes.DECIMAL(15, 2), allowNull: true, field: 'amount' },
    paidAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'paid_amount' },
    remainingBalance: { type: DataTypes.DECIMAL(15, 2), allowNull: false, defaultValue: 0, field: 'remaining_balance' },
    balanceAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: true, field: 'balance_amount' },
    currency: { type: DataTypes.STRING(10), allowNull: false, defaultValue: 'AED', field: 'currency' },
    exchangeRateToAed: { type: DataTypes.DECIMAL(12, 6), allowNull: false, defaultValue: 1, field: 'exchange_rate_to_aed' },
    paymentMethod: { type: DataTypes.STRING(50), allowNull: false, field: 'payment_method' },
    transactionId: { type: DataTypes.STRING(255), allowNull: true, field: 'transaction_id' },
    paymentDate: { type: DataTypes.DATE, allowNull: false, field: 'payment_date' },
    status: { type: DataTypes.ENUM('pending', 'processing', 'completed', 'paid', 'failed', 'refunded'), allowNull: false, defaultValue: 'pending', field: 'status' },
    dueDate: { type: DataTypes.DATE, allowNull: true, field: 'due_date' },
    installmentNumber: { type: DataTypes.INTEGER, allowNull: true, field: 'installment_number' },
    totalInstallments: { type: DataTypes.INTEGER, allowNull: true, field: 'total_installments' },
    milestoneName: { type: DataTypes.STRING(255), allowNull: true, field: 'milestone_name' },
    gateway: { type: DataTypes.STRING(50), allowNull: true, field: 'gateway' },
    gatewayTransactionId: { type: DataTypes.STRING(255), allowNull: true, field: 'gateway_transaction_id' },
    receiptUrl: { type: DataTypes.STRING(500), allowNull: true, field: 'receipt_url' },
    description: { type: DataTypes.TEXT, allowNull: true, field: 'description' },
    receiptType: { type: DataTypes.STRING(50), allowNull: true, field: 'receipt_type' },
    clientName: { type: DataTypes.STRING(255), allowNull: true, field: 'client_name' },
    clientEmail: { type: DataTypes.STRING(255), allowNull: true, field: 'client_email' },
    clientPhone: { type: DataTypes.STRING(80), allowNull: true, field: 'client_phone' },
    clientAddress: { type: DataTypes.TEXT, allowNull: true, field: 'client_address' },
    serviceName: { type: DataTypes.STRING(255), allowNull: true, field: 'service_name' },
    branchName: { type: DataTypes.STRING(255), allowNull: true, field: 'branch_name' },
    consultantName: { type: DataTypes.STRING(255), allowNull: true, field: 'consultant_name' },
    taxAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: true, defaultValue: 0, field: 'tax_amount' },
    discountAmount: { type: DataTypes.DECIMAL(15, 2), allowNull: true, defaultValue: 0, field: 'discount_amount' },
    notes: { type: DataTypes.TEXT, allowNull: true, field: 'notes' },
    createdBy: { type: DataTypes.INTEGER, allowNull: false, field: 'created_by', references: { model: 'crm_employee', key: 'id' } },
    createdAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'created_at' },
    updatedAt: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW, field: 'updated_at' },
    accountantStatus: { type: DataTypes.STRING(20), allowNull: true, defaultValue: 'pending', field: 'accountant_status' },
    accountantRemarks: { type: DataTypes.TEXT, allowNull: true, field: 'accountant_remarks' },
    accountantId: { type: DataTypes.INTEGER, allowNull: true, field: 'accountant_id', references: { model: 'crm_employee', key: 'id' } },
    accountantVerifiedAt: { type: DataTypes.DATE, allowNull: true, field: 'accountant_verified_at' },
  },
  {
    sequelize,
    modelName: 'CrmContractReceipt',
    tableName: 'crm_contract_receipts',
    timestamps: false,
    freezeTableName: true,
  }
);

export { CrmContractReceipt };
export type { CrmContractReceiptAttributes, CrmContractReceiptCreationAttributes };
