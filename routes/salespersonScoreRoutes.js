const express = require('express');
const router = express.Router();
const db = require('../db');
// Get all salesperson scores
router.get('/salesperson-scores', async (req, res) => {
  try {
    console.log('Fetching all salesperson scores...');
    
    // Get all staff/salespersons
    const salespersonsQuery = `
      SELECT id, name, email, mobile_number, role, created_at 
      FROM accounts 
      WHERE role = 'staff'
      ORDER BY created_at DESC
    `;
    
    const salespersonsRes = await pool.query(salespersonsQuery);
    const salespersons = salespersonsRes.rows;
    const scores = [];

    // Calculate score for each salesperson
    for (const salesperson of salespersons) {
      const scoreData = await calculateSalespersonScore(salesperson.id);
      if (scoreData) {
        scores.push(scoreData);
      }
    }

    // Sort by score descending
    scores.sort((a, b) => parseFloat(b.score) - parseFloat(a.score));

    res.status(200).json({
      success: true,
      data: scores,
      count: scores.length,
      calculated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error getting salesperson scores:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate salesperson scores',
      details: error.message
    });
  }
});

// Get single salesperson score
router.get('/salesperson-scores/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Fetching salesperson score for ID: ${id}`);
    
    const scoreData = await calculateSalespersonScore(id);
    
    if (!scoreData) {
      return res.status(404).json({
        success: false,
        error: 'Salesperson not found'
      });
    }

    res.status(200).json({
      success: true,
      data: scoreData
    });
  } catch (error) {
    console.error('Error getting salesperson score:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to calculate salesperson score',
      details: error.message
    });
  }
});

// Get salesperson performance trends (last 6 months)
router.get('/salesperson-scores/:id/trends', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Fetching trends for salesperson ID: ${id}`);
    
    const trendsQuery = `
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as order_count,
        SUM(order_total) as monthly_revenue,
        SUM(staff_incentive) as monthly_incentive,
        COUNT(DISTINCT customer_id) as unique_customers
      FROM orders 
      WHERE staff_id = $1 
        AND created_at >= NOW() - INTERVAL '6 months'
        AND approval_status = 'approved'
        AND order_status != 'cancelled'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month ASC
    `;
    
    const trendsRes = await pool.query(trendsQuery, [id]);
    
    // Format the data
    const formattedTrends = trendsRes.rows.map(row => ({
      month: new Date(row.month).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      order_count: parseInt(row.order_count || 0),
      monthly_revenue: parseFloat(row.monthly_revenue || 0).toFixed(2),
      monthly_incentive: parseFloat(row.monthly_incentive || 0).toFixed(2),
      unique_customers: parseInt(row.unique_customers || 0)
    }));
    
    res.status(200).json({
      success: true,
      data: formattedTrends
    });
  } catch (error) {
    console.error('Error getting salesperson trends:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get salesperson trends',
      details: error.message
    });
  }
});

// Get salesperson leaderboard
router.get('/salesperson-scores/leaderboard/rank', async (req, res) => {
  try {
    const { period = 'monthly' } = req.query;
    console.log(`Fetching leaderboard for period: ${period}`);
    
    let interval;
    switch (period) {
      case 'weekly':
        interval = "INTERVAL '7 days'";
        break;
      case 'monthly':
        interval = "INTERVAL '30 days'";
        break;
      case 'quarterly':
        interval = "INTERVAL '90 days'";
        break;
      default:
        interval = "INTERVAL '30 days'";
    }

    const leaderboardQuery = `
      SELECT 
        a.id,
        a.name,
        a.email,
        COUNT(o.id) as order_count,
        COALESCE(SUM(o.order_total), 0) as total_revenue,
        COALESCE(SUM(o.staff_incentive), 0) as total_incentive,
        COUNT(DISTINCT o.customer_id) as unique_customers
      FROM accounts a
      LEFT JOIN orders o ON a.id = o.staff_id 
        AND o.created_at >= NOW() - ${interval}
        AND o.approval_status = 'approved'
        AND o.order_status != 'cancelled'
      WHERE a.role = 'staff'
      GROUP BY a.id, a.name, a.email
      ORDER BY total_revenue DESC
      LIMIT 10
    `;
    
    const leaderboardRes = await pool.query(leaderboardQuery);
    
    // Format the data
    const formattedLeaderboard = leaderboardRes.rows.map((row, index) => ({
      ...row,
      order_count: parseInt(row.order_count || 0),
      total_revenue: parseFloat(row.total_revenue || 0).toFixed(2),
      total_incentive: parseFloat(row.total_incentive || 0).toFixed(2),
      unique_customers: parseInt(row.unique_customers || 0),
      rank: index + 1
    }));
    
    res.status(200).json({
      success: true,
      data: formattedLeaderboard,
      period: period
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get leaderboard',
      details: error.message
    });
  }
});

// Helper function to calculate salesperson score
async function calculateSalespersonScore(salespersonId) {
  try {
    // 1. Get salesperson details
    const salespersonQuery = `
      SELECT id, name, email, mobile_number, role, created_at 
      FROM accounts 
      WHERE id = $1 AND role = 'staff'
    `;
    const salespersonRes = await pool.query(salespersonQuery, [salespersonId]);
    
    if (salespersonRes.rows.length === 0) {
      return null;
    }

    const salesperson = salespersonRes.rows[0];

    // 2. Get total orders and revenue
    const ordersQuery = `
      SELECT 
        COUNT(*) as total_orders,
        SUM(order_total) as total_revenue,
        SUM(discount_amount) as total_discount,
        AVG(order_total) as avg_order_value,
        COUNT(CASE WHEN order_status = 'cancelled' THEN 1 END) as cancelled_orders,
        COUNT(CASE WHEN order_status = 'completed' THEN 1 END) as completed_orders,
        COUNT(CASE WHEN order_status IN ('pending', 'processing') THEN 1 END) as pending_orders
      FROM orders 
      WHERE staff_id = $1 
        AND approval_status = 'approved'
        AND order_status != 'cancelled'
    `;
    const ordersRes = await pool.query(ordersQuery, [salespersonId]);
    const orderStats = ordersRes.rows[0];

    // 3. Get recent performance (last 30 days)
    const recentOrdersQuery = `
      SELECT 
        COUNT(*) as recent_orders,
        SUM(order_total) as recent_revenue,
        AVG(order_total) as recent_avg_order,
        SUM(staff_incentive) as recent_incentive
      FROM orders 
      WHERE staff_id = $1 
        AND created_at >= NOW() - INTERVAL '30 days'
        AND approval_status = 'approved'
        AND order_status != 'cancelled'
    `;
    const recentOrdersRes = await pool.query(recentOrdersQuery, [salespersonId]);
    const recentStats = recentOrdersRes.rows[0];

    // 4. Get customer retention rate
    const customersQuery = `
      SELECT 
        COUNT(DISTINCT customer_id) as unique_customers,
        COUNT(DISTINCT CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN customer_id END) as recent_customers
      FROM orders 
      WHERE staff_id = $1 
        AND approval_status = 'approved'
        AND order_status != 'cancelled'
    `;
    const customersRes = await pool.query(customersQuery, [salespersonId]);
    const customerStats = customersRes.rows[0];

    // 5. Calculate score components (0-10 scale)

    // Revenue Score (30% weight)
    const totalRevenue = parseFloat(orderStats.total_revenue || 0);
    const revenueScore = Math.min(10, (totalRevenue / 1000000) * 10);

    // Order Volume Score (20% weight)
    const totalOrders = parseFloat(orderStats.total_orders || 0);
    const orderVolumeScore = Math.min(10, (totalOrders / 50) * 10);

    // Average Order Value Score (15% weight)
    const avgOrderValue = parseFloat(orderStats.avg_order_value || 0);
    const avgOrderValueScore = Math.min(10, (avgOrderValue / 50000) * 10);

    // Completion Rate Score (15% weight)
    const completedOrders = parseFloat(orderStats.completed_orders || 0);
    const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) : 0;
    const completionRateScore = completionRate * 10;

    // Recent Performance Score (10% weight)
    const recentRevenue = parseFloat(recentStats.recent_revenue || 0);
    const recentGrowth = recentRevenue > 0 && totalRevenue > 0 ? 
      (recentRevenue / (totalRevenue / 12)) : 0; // Compare with monthly average
    const recentPerformanceScore = Math.min(10, recentGrowth * 10);

    // Customer Retention Score (10% weight)
    const uniqueCustomers = parseFloat(customerStats.unique_customers || 0);
    const recentCustomers = parseFloat(customerStats.recent_customers || 0);
    const retentionRate = recentCustomers > 0 && uniqueCustomers > 0 ?
      (recentCustomers / uniqueCustomers) * 2 : 0;
    const retentionScore = Math.min(10, retentionRate * 10);

    // Calculate weighted total score
    const totalScore = (
      (revenueScore * 0.30) +
      (orderVolumeScore * 0.20) +
      (avgOrderValueScore * 0.15) +
      (completionRateScore * 0.15) +
      (recentPerformanceScore * 0.10) +
      (retentionScore * 0.10)
    );

    // Determine score tier
    const getScoreTier = (score) => {
      if (score >= 8) return 'Diamond';
      if (score >= 6) return 'Gold';
      if (score >= 4) return 'Silver';
      return 'Basic';
    };

    const scoreTier = getScoreTier(totalScore);

    // 6. Get assigned retailers count
    const retailersQuery = `
      SELECT COUNT(DISTINCT customer_id) as assigned_retailers
      FROM orders 
      WHERE staff_id = $1 
        AND approval_status = 'approved'
    `;
    const retailersRes = await pool.query(retailersQuery, [salespersonId]);
    const assignedRetailers = retailersRes.rows[0].assigned_retailers;

    // 7. Calculate incentive earned
    const incentiveQuery = `
      SELECT COALESCE(SUM(staff_incentive), 0) as total_incentive
      FROM orders 
      WHERE staff_id = $1 
        AND approval_status = 'approved'
        AND order_status != 'cancelled'
    `;
    const incentiveRes = await pool.query(incentiveQuery, [salespersonId]);
    const totalIncentive = incentiveRes.rows[0].total_incentive;

    // 8. Get success rate (orders that reached completion)
    const successRateQuery = `
      SELECT 
        COUNT(*) as total_processed,
        COUNT(CASE WHEN order_status = 'completed' THEN 1 END) as successful
      FROM orders 
      WHERE staff_id = $1 
        AND approval_status = 'approved'
        AND order_status IN ('completed', 'cancelled', 'returned')
    `;
    const successRateRes = await pool.query(successRateQuery, [salespersonId]);
    const successStats = successRateRes.rows[0];
    const successRate = parseFloat(successStats.total_processed) > 0 ? 
      (parseFloat(successStats.successful) / parseFloat(successStats.total_processed)) * 100 : 0;

    return {
      salesperson_id: salesperson.id,
      name: salesperson.name,
      email: salesperson.email,
      mobile_number: salesperson.mobile_number,
      role: salesperson.role,
      join_date: salesperson.created_at,
      
      // Score details
      score: totalScore.toFixed(2),
      score_tier: scoreTier,
      last_score_calculated: new Date().toISOString(),
      
      // Performance metrics
      total_orders: parseInt(totalOrders),
      total_revenue: totalRevenue.toFixed(2),
      avg_order_value: avgOrderValue.toFixed(2),
      completion_rate: (completionRate * 100).toFixed(2),
      success_rate: successRate.toFixed(2),
      cancelled_orders: parseInt(orderStats.cancelled_orders || 0),
      pending_orders: parseInt(orderStats.pending_orders || 0),
      
      // Recent performance
      recent_orders: parseInt(recentStats.recent_orders || 0),
      recent_revenue: recentRevenue.toFixed(2),
      recent_avg_order: parseFloat(recentStats.recent_avg_order || 0).toFixed(2),
      recent_incentive: parseFloat(recentStats.recent_incentive || 0).toFixed(2),
      
      // Customer metrics
      unique_customers: parseInt(uniqueCustomers),
      recent_customers: parseInt(recentCustomers),
      assigned_retailers: parseInt(assignedRetailers || 0),
      
      // Financials
      total_incentive: parseFloat(totalIncentive || 0).toFixed(2),
      total_discount: parseFloat(orderStats.total_discount || 0).toFixed(2),
      
      // Score components (for analysis)
      score_components: {
        revenue_score: revenueScore.toFixed(2),
        order_volume_score: orderVolumeScore.toFixed(2),
        avg_order_value_score: avgOrderValueScore.toFixed(2),
        completion_rate_score: completionRateScore.toFixed(2),
        recent_performance_score: recentPerformanceScore.toFixed(2),
        retention_score: retentionScore.toFixed(2)
      }
    };
  } catch (error) {
    console.error('Error calculating salesperson score:', error);
    throw error;
  }
}

// Get salesperson detailed performance analytics
router.get('/salesperson-scores/:id/analytics', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`Fetching analytics for salesperson ID: ${id}`);
    
    // Get monthly performance
    const monthlyQuery = `
      SELECT 
        DATE_TRUNC('month', o.created_at) as month,
        COUNT(o.id) as order_count,
        SUM(o.order_total) as revenue,
        AVG(o.order_total) as avg_order_value,
        SUM(o.staff_incentive) as incentive,
        COUNT(DISTINCT o.customer_id) as new_customers
      FROM orders o
      WHERE o.staff_id = $1 
        AND o.approval_status = 'approved'
        AND o.order_status != 'cancelled'
        AND o.created_at >= NOW() - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', o.created_at)
      ORDER BY month DESC
    `;
    
    // Get top customers
    const topCustomersQuery = `
      SELECT 
        c.id,
        c.name,
        c.business_name,
        COUNT(o.id) as order_count,
        SUM(o.order_total) as total_spent,
        MAX(o.created_at) as last_order_date
      FROM orders o
      JOIN accounts c ON o.customer_id = c.id
      WHERE o.staff_id = $1 
        AND o.approval_status = 'approved'
        AND o.order_status != 'cancelled'
      GROUP BY c.id, c.name, c.business_name
      ORDER BY total_spent DESC
      LIMIT 10
    `;
    
    // Get product category performance
    const categoryQuery = `
      SELECT 
        p.category,
        COUNT(oi.id) as items_sold,
        SUM(oi.total_amount) as revenue,
        AVG(oi.sale_price) as avg_price
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN orders o ON oi.order_number = o.order_number
      WHERE o.staff_id = $1 
        AND o.approval_status = 'approved'
        AND o.order_status != 'cancelled'
      GROUP BY p.category
      ORDER BY revenue DESC
    `;
    
    const [monthlyRes, customersRes, categoryRes] = await Promise.all([
      pool.query(monthlyQuery, [id]),
      pool.query(topCustomersQuery, [id]),
      pool.query(categoryQuery, [id])
    ]);
    
    res.status(200).json({
      success: true,
      data: {
        monthly_performance: monthlyRes.rows,
        top_customers: customersRes.rows,
        category_performance: categoryRes.rows
      }
    });
  } catch (error) {
    console.error('Error getting salesperson analytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get salesperson analytics',
      details: error.message
    });
  }
});

// Get salesperson comparison
router.get('/salesperson-scores/compare', async (req, res) => {
  try {
    const { ids } = req.query;
    const idList = ids.split(',').map(id => parseInt(id.trim()));
    
    console.log(`Comparing salespersons: ${idList}`);
    
    if (!idList.length || idList.length > 5) {
      return res.status(400).json({
        success: false,
        error: 'Please provide 1-5 salesperson IDs to compare'
      });
    }
    
    const comparisonData = [];
    
    for (const id of idList) {
      const scoreData = await calculateSalespersonScore(id);
      if (scoreData) {
        comparisonData.push(scoreData);
      }
    }
    
    // Calculate averages for comparison
    const averages = {
      score: comparisonData.reduce((sum, sp) => sum + parseFloat(sp.score), 0) / comparisonData.length,
      total_revenue: comparisonData.reduce((sum, sp) => sum + parseFloat(sp.total_revenue), 0) / comparisonData.length,
      total_orders: comparisonData.reduce((sum, sp) => sum + parseFloat(sp.total_orders), 0) / comparisonData.length,
      avg_order_value: comparisonData.reduce((sum, sp) => sum + parseFloat(sp.avg_order_value), 0) / comparisonData.length,
      unique_customers: comparisonData.reduce((sum, sp) => sum + parseFloat(sp.unique_customers), 0) / comparisonData.length
    };
    
    res.status(200).json({
      success: true,
      data: comparisonData,
      averages: averages,
      count: comparisonData.length
    });
  } catch (error) {
    console.error('Error comparing salespersons:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to compare salespersons',
      details: error.message
    });
  }
});

// Update salesperson score manually (admin only)
router.post('/salesperson-scores/:id/update', async (req, res) => {
  try {
    const { id } = req.params;
    const { manual_score, notes } = req.body;
    
    console.log(`Updating manual score for salesperson ID: ${id}`);
    
    if (!manual_score || manual_score < 0 || manual_score > 10) {
      return res.status(400).json({
        success: false,
        error: 'Manual score must be between 0 and 10'
      });
    }
    
    // Check if salesperson exists
    const checkQuery = `SELECT id FROM accounts WHERE id = $1 AND role = 'staff'`;
    const checkRes = await pool.query(checkQuery, [id]);
    
    if (checkRes.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Salesperson not found'
      });
    }
    
    // Update or insert manual score
    const updateQuery = `
      INSERT INTO salesperson_scores 
        (salesperson_id, manual_score, calculated_score, total_score, notes, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (salesperson_id) 
      DO UPDATE SET 
        manual_score = EXCLUDED.manual_score,
        total_score = (EXCLUDED.manual_score * 0.3 + EXCLUDED.calculated_score * 0.7),
        notes = EXCLUDED.notes,
        updated_at = NOW()
      RETURNING *
    `;
    
    // Get calculated score
    const calculatedData = await calculateSalespersonScore(id);
    const calculatedScore = calculatedData ? parseFloat(calculatedData.score) : 0;
    const totalScore = (parseFloat(manual_score) * 0.3) + (calculatedScore * 0.7);
    
    const updateRes = await pool.query(updateQuery, [
      id, 
      manual_score, 
      calculatedScore, 
      totalScore.toFixed(2), 
      notes || null
    ]);
    
    res.status(200).json({
      success: true,
      data: updateRes.rows[0],
      message: 'Salesperson score updated successfully'
    });
  } catch (error) {
    console.error('Error updating salesperson score:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update salesperson score',
      details: error.message
    });
  }
});

// Get salesperson score history
router.get('/salesperson-scores/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 12 } = req.query;
    
    console.log(`Fetching score history for salesperson ID: ${id}`);
    
    // Check if history table exists, if not, create it
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS salesperson_score_history (
        id SERIAL PRIMARY KEY,
        salesperson_id INTEGER REFERENCES accounts(id),
        calculated_score DECIMAL(5,2),
        manual_score DECIMAL(5,2),
        total_score DECIMAL(5,2),
        month_year VARCHAR(10),
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    
    await pool.query(createTableQuery);
    
    // Get history
    const historyQuery = `
      SELECT 
        month_year,
        calculated_score,
        manual_score,
        total_score,
        notes,
        created_at
      FROM salesperson_score_history
      WHERE salesperson_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `;
    
    const historyRes = await pool.query(historyQuery, [id, limit]);
    
    res.status(200).json({
      success: true,
      data: historyRes.rows,
      count: historyRes.rows.length
    });
  } catch (error) {
    console.error('Error getting score history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get score history',
      details: error.message
    });
  }
});

module.exports = router;