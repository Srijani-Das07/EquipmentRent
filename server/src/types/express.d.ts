declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: 'CUSTOMER' | 'STAFF' | 'ADMIN';
        isActive: boolean;
        createdAt: Date;
      };
    }
  }
}

export {};