import { db } from '@vercel/postgres';

export default async function handler(req, res) {
  const client = await db.connect();

  try {
    // 1. GET DATA FROM POSTGRES SQL
    if (req.method === 'GET') {
      const { rows } = await client.sql`
        SELECT 
          id, 
          TO_CHAR(date, 'YYYY-MM-DD') as date, 
          fares, wallet, gas, food, mobile_data as data, maintenance as maint, other_expenses as other 
        FROM rider_ledger 
        ORDER BY date ASC;
      `;
      return res.status(200).json(rows);
    }

    // 2. SAVE OR UPDATE DATA IN POSTGRES SQL
    if (req.method === 'POST') {
      const { id, date, fares, wallet, gas, food, data, maint, other } = req.body;

      await client.sql`
        INSERT INTO rider_ledger (id, date, fares, wallet, gas, food, mobile_data, maintenance, other_expenses)
        VALUES (${id}, ${date}, ${fares}, ${wallet}, ${gas}, ${food}, ${data}, ${maint}, ${other})
        ON CONFLICT (id) DO UPDATE SET
          date = EXCLUDED.date,
          fares = EXCLUDED.fares,
          wallet = EXCLUDED.wallet,
          gas = EXCLUDED.gas,
          food = EXCLUDED.food,
          mobile_data = EXCLUDED.mobile_data,
          maintenance = EXCLUDED.maintenance,
          other_expenses = EXCLUDED.other_expenses;
      `;
      return res.status(200).json({ success: true, message: 'Saved to SQL successfully' });
    }

    // 3. DELETE DATA FROM POSTGRES SQL
    if (req.method === 'DELETE') {
      const { id } = req.query;
      await client.sql`DELETE FROM rider_ledger WHERE id = ${id};`;
      return res.status(200).json({ success: true, message: 'Deleted from SQL successfully' });
    }

    return res.status(405).json({ message: 'Method Not Allowed' });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
}