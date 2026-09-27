import { DataTypes, Model, Optional } from 'sequelize';
import { sequelize } from '../lib/sequelize';
import { pushNotification } from '../lib/pusherServer';
import { isPushEligible, sendMobilePush } from '../lib/mobilePush';

export interface CrmcNotificationsAttributes {
  id: number;
  user_id: number;
  type: string;
  title: string;
  message: string;
  related_id: number | null;
  related_type: string | null;
  link: string | null;
  is_read: boolean;
  priority: string;
  created_at: Date;
  updated_at: Date;
}

export interface CrmcNotificationsCreationAttributes extends Optional<CrmcNotificationsAttributes, 'id' | 'related_id' | 'related_type' | 'link' | 'is_read' | 'created_at' | 'updated_at'> {}

export class CrmcNotifications extends Model<CrmcNotificationsAttributes, CrmcNotificationsCreationAttributes> implements CrmcNotificationsAttributes {
  declare id: number;
  declare user_id: number;
  declare type: string;
  declare title: string;
  declare message: string;
  declare related_id: number | null;
  declare related_type: string | null;
  declare link: string | null;
  declare is_read: boolean;
  declare priority: string;
  declare created_at: Date;
  declare updated_at: Date;

  // Associations
  declare dmEmployee?: any;

  public static associate(models: any) {
    CrmcNotifications.belongsTo(models.CrmEmployee, {
      foreignKey: 'user_id',
      as: 'dmEmployee'
    });
  }
}

CrmcNotifications.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    type: {
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    title: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    related_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    related_type: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    link: {
      type: DataTypes.STRING(500),
      allowNull: true,
    },
    is_read: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    priority: {
      type: DataTypes.STRING(20),
      allowNull: false,
      defaultValue: 'normal',
    },
    created_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
  },
  {
    sequelize,
    modelName: 'CrmcNotifications',
    tableName: 'crm_notifications',
    timestamps: false,
    freezeTableName: true,
    hooks: {
      // Real-time push on top of the notification bell's poll (see
      // src/lib/pusherServer.ts). Hooked at the model rather than each of
      // the ~7 call sites across the app that create a notification, so
      // every current and future path gets live delivery for free. No-ops
      // safely when Pusher isn't configured, and never throws — a push
      // failure must never roll back a notification that already exists.
      async afterCreate(notification, options) {
        // Native push for the mobile app (FCM/APNs). Only a handful of types
        // are pushed (see src/lib/mobilePush.ts). When the notification is
        // created inside a transaction (crm-workflow-service.ts), wait for the
        // COMMIT so a rolled-back workflow step never pings a phone. Never
        // throws; sendMobilePush swallows its own errors.
        if (isPushEligible(notification.type)) {
          const dispatch = () => sendMobilePush({
            id: notification.id,
            user_id: notification.user_id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            related_id: notification.related_id,
            related_type: notification.related_type,
          });
          if (options?.transaction) {
            options.transaction.afterCommit(() => { void dispatch(); });
          } else {
            await dispatch();
          }
        }

        try {
          await pushNotification(notification.user_id, {
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            priority: notification.priority,
            isRead: Boolean(notification.is_read),
            createdAt: notification.created_at instanceof Date
              ? notification.created_at.toISOString()
              : String(notification.created_at),
            relatedId: notification.related_id,
            relatedType: notification.related_type,
            link: notification.link,
          });
        } catch (error) {
          console.error('Failed to push notification after create:', error);
        }
      },
    },
  }
);
