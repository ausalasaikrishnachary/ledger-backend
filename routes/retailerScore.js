const express = require('express');
const router = express.Router();
const db = require('../db');

// Helper function for promise-based queries
function queryPromise(connection, sql, params = []) {
  return new Promise((resolve, reject) => {
    connection.query(sql, params, (err, results) => {
      if (err) reject(err);
      resolve(results);
    });
  });
}

// Calculate and update retailer scores
router.post('/calculate-retailer-scores', async (req, res) => {
  const { retailerId, period } = req.body; // Optional: calculate for specific retailer or all
  
  console.log('🔄 Calculating retailer scores...');

  db.getConnection(async (err, connection) => {
    if (err) {
      console.error('❌ Database connection error:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }

    try {
      // Get all retailers (or specific one)
      let retailersQuery = 'SELECT id, name, business_name FROM accounts WHERE role = "retailer"';
      let queryParams = [];
      
      if (retailerId) {
        retailersQuery += ' AND id = ?';
        queryParams.push(retailerId);
      }
      
      const retailers = await queryPromise(connection, retailersQuery, queryParams);
      
      console.log(`📊 Found ${retailers.length} retailers to score`);
      
      const scoringResults = [];
      
      // Calculate score for each retailer
      for (const retailer of retailers) {
        const scoreResult = await calculateRetailerScore(connection, retailer.id, period);
        scoringResults.push({
          retailerId: retailer.id,
          retailerName: retailer.business_name || retailer.name,
          ...scoreResult
        });
      }
      
      connection.release();
      
      res.json({
        success: true,
        message: `Scores calculated for ${retailers.length} retailers`,
        results: scoringResults
      });
      
    } catch (error) {
      connection.release();
      console.error('❌ Score calculation error:', error);
      res.status(500).json({ error: 'Failed to calculate scores', details: error.message });
    }
  });
});

// Get retailer scores
router.get('/retailer-scores', (req, res) => {
  const { page = 1, limit = 50, tier, sortBy = 'score', sortOrder = 'DESC' } = req.query;
  const offset = (page - 1) * limit;
  
  let whereClause = 'WHERE role = "retailer"';
  let queryParams = [];
  
  if (tier && tier !== 'all') {
    whereClause += ' AND score_tier = ?';
    queryParams.push(tier);
  }
  
  const countQuery = `SELECT COUNT(*) as total FROM accounts ${whereClause}`;
  
  db.query(countQuery, queryParams, (err, countResult) => {
    if (err) {
      console.error('❌ Count query error:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    const total = countResult[0].total;
    const totalPages = Math.ceil(total / limit);
    
    // Validate sort column
    const validSortColumns = ['score', 'name', 'business_name', 'last_score_calculated', 'total_purchases'];
    const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'score';
    
    const query = `
      SELECT 
        a.id,
        a.name,
        a.business_name,
        a.email,
        a.mobile_number,
        a.score,
        a.score_tier,
        a.last_score_calculated,
        a.assigned_staff,
        a.discount,
        a.Target,
        JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')) as total_purchases,
        JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.order_count')) as order_count,
        JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.last_order_date')) as last_order_date,
        JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.payment_score')) as payment_score,
        JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.growth_score')) as growth_score
      FROM accounts a
      ${whereClause}
      ORDER BY ${sortColumn === 'score' ? 'a.score' : sortColumn} ${sortOrder}
      LIMIT ? OFFSET ?
    `;
    
    const finalParams = [...queryParams, parseInt(limit), parseInt(offset)];
    
    db.query(query, finalParams, (err, results) => {
      if (err) {
        console.error('❌ Query error:', err);
        return res.status(500).json({ error: 'Failed to fetch scores' });
      }
      
      res.json({
        success: true,
        data: results,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages
        }
      });
    });
  });
});

// Get specific retailer score details
router.get('/retailer-scores/:retailerId', (req, res) => {
  const { retailerId } = req.params;
  
  const query = `
    SELECT 
      a.*,
      COALESCE(
        (SELECT SUM(net_payable) 
         FROM orders 
         WHERE customer_id = a.id 
         AND order_status != 'Cancelled'
         AND invoice_status = 1
        ), 0
      ) as lifetime_purchase,
      COALESCE(
        (SELECT COUNT(*) 
         FROM orders 
         WHERE customer_id = a.id 
         AND order_status != 'Cancelled'
         AND invoice_status = 1
        ), 0
      ) as lifetime_orders
    FROM accounts a
    WHERE a.id = ? AND a.role = 'retailer'
  `;
  
  db.query(query, [retailerId], (err, results) => {
    if (err) {
      console.error('❌ Query error:', err);
      return res.status(500).json({ error: 'Failed to fetch retailer score' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: 'Retailer not found' });
    }
    
    const retailer = results[0];
    
    // Get detailed scoring breakdown
    db.getConnection(async (err, connection) => {
      if (err) {
        return res.status(500).json({ error: 'Database connection failed' });
      }
      
      try {
        const scoreDetails = await calculateRetailerScore(connection, retailerId);
        const breakdown = await getScoreBreakdown(connection, retailerId);
        
        connection.release();
        
        res.json({
          success: true,
          data: {
            ...retailer,
            score_breakdown: breakdown,
            detailed_scores: scoreDetails
          }
        });
        
      } catch (error) {
        connection.release();
        console.error('❌ Error getting score breakdown:', error);
        res.status(500).json({ error: 'Failed to get score breakdown' });
      }
    });
  });
});

// Update retailer score manually (admin override)
router.put('/retailer-scores/:retailerId', (req, res) => {
  const { retailerId } = req.params;
  const { score, score_tier, score_details } = req.body;
  
  if (score !== undefined && (score < 0 || score > 100)) {
    return res.status(400).json({ error: 'Score must be between 0 and 100' });
  }
  
  const validTiers = ['Platinum', 'Gold', 'Silver', 'Bronze', 'Basic'];
  if (score_tier && !validTiers.includes(score_tier)) {
    return res.status(400).json({ error: 'Invalid tier' });
  }
  
  const updateData = {
    last_score_calculated: new Date()
  };
  
  if (score !== undefined) updateData.score = score;
  if (score_tier !== undefined) updateData.score_tier = score_tier;
  if (score_details !== undefined) {
    try {
      updateData.score_details = JSON.stringify(score_details);
    } catch (e) {
      return res.status(400).json({ error: 'Invalid score_details JSON' });
    }
  }
  
  const query = 'UPDATE accounts SET ? WHERE id = ? AND role = "retailer"';
  
  db.query(query, [updateData, retailerId], (err, results) => {
    if (err) {
      console.error('❌ Update error:', err);
      return res.status(500).json({ error: 'Failed to update score' });
    }
    
    if (results.affectedRows === 0) {
      return res.status(404).json({ error: 'Retailer not found' });
    }
    
    res.json({
      success: true,
      message: 'Score updated successfully',
      data: updateData
    });
  });
});

// Get score distribution analytics
router.get('/score-analytics', (req, res) => {
  const queries = [
    // Tier distribution
    `SELECT 
      score_tier,
      COUNT(*) as count,
      ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM accounts WHERE role = 'retailer'), 2) as percentage
     FROM accounts 
     WHERE role = 'retailer'
     GROUP BY score_tier
     ORDER BY 
       CASE score_tier
         WHEN 'Platinum' THEN 1
         WHEN 'Gold' THEN 2
         WHEN 'Silver' THEN 3
         WHEN 'Bronze' THEN 4
         ELSE 5
       END`,
    
    // Score ranges
    `SELECT 
      CASE
        WHEN score >= 90 THEN '90-100'
        WHEN score >= 80 THEN '80-89'
        WHEN score >= 70 THEN '70-79'
        WHEN score >= 60 THEN '60-69'
        WHEN score >= 50 THEN '50-59'
        ELSE '0-49'
      END as score_range,
      COUNT(*) as count,
      AVG(score) as avg_score
     FROM accounts 
     WHERE role = 'retailer'
     GROUP BY score_range
     ORDER BY MIN(score)`,
    
    // Top performers
    `SELECT 
      business_name as name,
      score,
      score_tier,
      JSON_UNQUOTE(JSON_EXTRACT(score_details, '$.total_purchases')) as total_purchases
     FROM accounts 
     WHERE role = 'retailer'
     ORDER BY score DESC
     LIMIT 10`,
    
    // Needs attention
    `SELECT 
      business_name as name,
      score,
      score_tier,
      last_score_calculated,
      JSON_UNQUOTE(JSON_EXTRACT(score_details, '$.last_order_date')) as last_order_date
     FROM accounts 
     WHERE role = 'retailer' 
     AND (score < 50 OR last_score_calculated IS NULL)
     ORDER BY score ASC
     LIMIT 10`
  ];
  
  db.getConnection((err, connection) => {
    if (err) {
      console.error('❌ Connection error:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }
    
    const results = {};
    let completed = 0;
    
    queries.forEach((query, index) => {
      connection.query(query, (err, data) => {
        if (err) {
          console.error(`❌ Query ${index} error:`, err);
        } else {
          switch(index) {
            case 0: results.tierDistribution = data; break;
            case 1: results.scoreRanges = data; break;
            case 2: results.topPerformers = data; break;
            case 3: results.needsAttention = data; break;
          }
        }
        
        completed++;
        if (completed === queries.length) {
          connection.release();
          
          // Calculate overall stats
          if (results.tierDistribution) {
            const total = results.tierDistribution.reduce((sum, item) => sum + item.count, 0);
            results.overallStats = {
              totalRetailers: total,
              avgScore: results.tierDistribution.reduce((sum, item) => {
                const tierAvg = item.score_tier === 'Platinum' ? 90 :
                               item.score_tier === 'Gold' ? 75 :
                               item.score_tier === 'Silver' ? 65 :
                               item.score_tier === 'Bronze' ? 45 : 20;
                return sum + (tierAvg * item.count);
              }, 0) / total
            };
          }
          
          res.json({
            success: true,
            analytics: results
          });
        }
      });
    });
  });
});

// ------------------------------------------------------------
// SCORING ENGINE FUNCTIONS
// ------------------------------------------------------------

async function calculateRetailerScore(connection, retailerId, period = '90') {
  try {
    // 1. Get transaction data from orders table
    const ordersQuery = `
      SELECT 
        COUNT(*) as order_count,
        SUM(net_payable) as total_purchases,
        AVG(net_payable) as avg_order_value,
        MAX(created_at) as last_order_date,
        AVG(credit_period) as avg_credit_days,
        DATEDIFF(NOW(), MAX(created_at)) as days_since_last_order
      FROM orders 
      WHERE customer_id = ? 
        AND order_status != 'Cancelled'
        AND invoice_status = 1
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    
    const ordersData = await queryPromise(connection, ordersQuery, [retailerId, period]);
    const orderStats = ordersData[0] || {};
    
    // 2. Get payment data from voucher table
    const paymentQuery = `
      SELECT 
        COUNT(*) as total_transactions,
        SUM(CASE WHEN balance_amount > 0 THEN 1 ELSE 0 END) as pending_payments,
        AVG(balance_amount) as avg_balance,
        SUM(paid_amount) as total_paid
      FROM voucher 
      WHERE PartyID = ? 
        AND TransactionType = 'Sales'
        AND Date >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    
    const paymentData = await queryPromise(connection, paymentQuery, [retailerId, period]);
    const paymentStats = paymentData[0] || {};
    
    // 3. Get item diversity from order_items
    const diversityQuery = `
      SELECT 
        COUNT(DISTINCT product_id) as unique_products,
        COUNT(*) as total_items
      FROM order_items oi
      JOIN orders o ON oi.order_number = o.order_number
      WHERE o.customer_id = ?
        AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND o.order_status != 'Cancelled'
    `;
    
    const diversityData = await queryPromise(connection, diversityQuery, [retailerId, period]);
    const diversityStats = diversityData[0] || {};
    
    // 4. Calculate individual scores
    const scores = {
      // Transaction Volume Score (0-25 points)
      volumeScore: calculateVolumeScore(orderStats.total_purchases || 0),
      
      // Order Frequency Score (0-20 points)
      frequencyScore: calculateFrequencyScore(orderStats.order_count || 0),
      
      // Average Order Value Score (0-15 points)
      valueScore: calculateValueScore(orderStats.avg_order_value || 0),
      
      // Recency Score (0-15 points)
      recencyScore: calculateRecencyScore(orderStats.days_since_last_order || 999),
      
      // Payment Behavior Score (0-15 points)
      paymentScore: calculatePaymentScore(
        paymentStats.pending_payments || 0,
        paymentStats.total_transactions || 0,
        orderStats.avg_credit_days || 0
      ),
      
      // Product Diversity Score (0-10 points)
      diversityScore: calculateDiversityScore(
        diversityStats.unique_products || 0,
        diversityStats.total_items || 0
      )
    };
    
    // 5. Calculate weighted overall score
    const weights = {
      volumeScore: 0.25,    // 25%
      frequencyScore: 0.20, // 20%
      valueScore: 0.15,     // 15%
      recencyScore: 0.15,   // 15%
      paymentScore: 0.15,   // 15%
      diversityScore: 0.10  // 10%
    };
    
    let overallScore = 0;
    for (const [key, weight] of Object.entries(weights)) {
      overallScore += (scores[key] || 0) * weight;
    }
    
    overallScore = Math.round(overallScore * 100) / 100; // Round to 2 decimals
    
    // 6. Determine tier
    const tier = determineTier(overallScore);
    
    // 7. Prepare score details for storage
    const scoreDetails = {
      total_purchases: orderStats.total_purchases || 0,
      order_count: orderStats.order_count || 0,
      avg_order_value: orderStats.avg_order_value || 0,
      last_order_date: orderStats.last_order_date,
      avg_credit_days: orderStats.avg_credit_days || 0,
      days_since_last_order: orderStats.days_since_last_order || 999,
      pending_payments: paymentStats.pending_payments || 0,
      total_transactions: paymentStats.total_transactions || 0,
      unique_products: diversityStats.unique_products || 0,
      total_items: diversityStats.total_items || 0,
      individual_scores: scores,
      calculation_period: period,
      calculated_at: new Date().toISOString()
    };
    
    // 8. Update accounts table
    const updateQuery = `
      UPDATE accounts 
      SET score = ?,
          score_tier = ?,
          score_details = ?,
          last_score_calculated = NOW()
      WHERE id = ?
    `;
    
    await queryPromise(connection, updateQuery, [
      overallScore,
      tier,
      JSON.stringify(scoreDetails),
      retailerId
    ]);
    
    return {
      score: overallScore,
      tier,
      details: scoreDetails,
      individual_scores: scores
    };
    
  } catch (error) {
    console.error(`❌ Error calculating score for retailer ${retailerId}:`, error);
    throw error;
  }
}

// Scoring calculation functions
function calculateVolumeScore(totalPurchases) {
  // Scale: 0-25 points based on purchase volume
  if (totalPurchases >= 1000000) return 25;
  if (totalPurchases >= 500000) return 22;
  if (totalPurchases >= 250000) return 18;
  if (totalPurchases >= 100000) return 15;
  if (totalPurchases >= 50000) return 12;
  if (totalPurchases >= 25000) return 8;
  if (totalPurchases >= 10000) return 5;
  if (totalPurchases >= 5000) return 3;
  if (totalPurchases >= 1000) return 1;
  return 0;
}

function calculateFrequencyScore(orderCount) {
  // Scale: 0-20 points based on order frequency
  if (orderCount >= 50) return 20;
  if (orderCount >= 30) return 18;
  if (orderCount >= 20) return 15;
  if (orderCount >= 15) return 12;
  if (orderCount >= 10) return 9;
  if (orderCount >= 5) return 6;
  if (orderCount >= 3) return 4;
  if (orderCount >= 1) return 2;
  return 0;
}

function calculateValueScore(avgOrderValue) {
  // Scale: 0-15 points based on average order value
  if (avgOrderValue >= 50000) return 15;
  if (avgOrderValue >= 25000) return 12;
  if (avgOrderValue >= 15000) return 10;
  if (avgOrderValue >= 10000) return 8;
  if (avgOrderValue >= 5000) return 6;
  if (avgOrderValue >= 2500) return 4;
  if (avgOrderValue >= 1000) return 2;
  return 0;
}

function calculateRecencyScore(daysSinceLastOrder) {
  // Scale: 0-15 points based on how recent the last order was
  if (daysSinceLastOrder <= 7) return 15;
  if (daysSinceLastOrder <= 15) return 12;
  if (daysSinceLastOrder <= 30) return 10;
  if (daysSinceLastOrder <= 45) return 7;
  if (daysSinceLastOrder <= 60) return 5;
  if (daysSinceLastOrder <= 90) return 3;
  if (daysSinceLastOrder <= 120) return 1;
  return 0;
}

function calculatePaymentScore(pendingPayments, totalTransactions, avgCreditDays) {
  // Scale: 0-15 points based on payment behavior
  let score = 15;
  
  // Deduct for pending payments
  if (totalTransactions > 0) {
    const pendingRatio = pendingPayments / totalTransactions;
    if (pendingRatio > 0.5) score -= 8;
    else if (pendingRatio > 0.3) score -= 5;
    else if (pendingRatio > 0.1) score -= 3;
  }
  
  // Deduct for long credit days
  if (avgCreditDays > 45) score -= 5;
  else if (avgCreditDays > 30) score -= 3;
  else if (avgCreditDays > 15) score -= 1;
  
  return Math.max(0, score);
}

function calculateDiversityScore(uniqueProducts, totalItems) {
  // Scale: 0-10 points based on product diversity
  if (totalItems === 0) return 0;
  
  const diversityRatio = uniqueProducts / totalItems;
  
  if (diversityRatio >= 0.7) return 10;
  if (diversityRatio >= 0.5) return 8;
  if (diversityRatio >= 0.3) return 6;
  if (diversityRatio >= 0.2) return 4;
  if (diversityRatio >= 0.1) return 2;
  return 0;
}

function determineTier(score) {
  if (score >= 85) return 'Platinum';
  if (score >= 70) return 'Gold';
  if (score >= 55) return 'Silver';
  if (score >= 40) return 'Bronze';
  return 'Basic';
}

async function getScoreBreakdown(connection, retailerId) {
  // Get recent activity for breakdown
  const recentOrdersQuery = `
    SELECT 
      o.order_number,
      o.created_at,
      o.net_payable,
      o.credit_period,
      o.order_status,
      COUNT(oi.id) as item_count
    FROM orders o
    LEFT JOIN order_items oi ON o.order_number = oi.order_number
    WHERE o.customer_id = ?
      AND o.order_status != 'Cancelled'
      AND o.invoice_status = 1
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT 5
  `;
  
  const recentOrders = await queryPromise(connection, recentOrdersQuery, [retailerId]);
  
  const paymentHistoryQuery = `
    SELECT 
      InvoiceNumber,
      Date,
      TotalAmount,
      paid_amount,
      balance_amount,
      status
    FROM voucher
    WHERE PartyID = ?
      AND TransactionType = 'Sales'
    ORDER BY Date DESC
    LIMIT 5
  `;
  
  const paymentHistory = await queryPromise(connection, paymentHistoryQuery, [retailerId]);
  
  const growthQuery = `
    SELECT 
      DATE_FORMAT(created_at, '%Y-%m') as month,
      COUNT(*) as order_count,
      SUM(net_payable) as monthly_total
    FROM orders
    WHERE customer_id = ?
      AND order_status != 'Cancelled'
      AND invoice_status = 1
      AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m')
    ORDER BY month
  `;
  
  const growthData = await queryPromise(connection, growthQuery, [retailerId]);
  
  return {
    recent_orders: recentOrders,
    payment_history: paymentHistory,
    growth_trend: growthData,
    last_updated: new Date().toISOString()
  };
}

// ------------------------------------------------------------
// AUTOMATED SCORE UPDATING VIA WEBHOOKS/TRIGGERS
// ------------------------------------------------------------

// This function should be called when orders are created/updated
router.post('/update-score-on-order', async (req, res) => {
  const { customerId, orderNumber } = req.body;
  
  if (!customerId) {
    return res.status(400).json({ error: 'customerId is required' });
  }
  
  try {
    db.getConnection(async (err, connection) => {
      if (err) {
        console.error('❌ Connection error:', err);
        return res.status(500).json({ error: 'Database connection failed' });
      }
      
      try {
        await calculateRetailerScore(connection, customerId, '90');
        connection.release();
        
        res.json({
          success: true,
          message: 'Score updated successfully',
          customerId
        });
      } catch (error) {
        connection.release();
        throw error;
      }
    });
  } catch (error) {
    console.error('❌ Error updating score:', error);
    res.status(500).json({ error: 'Failed to update score', details: error.message });
  }
});

// Schedule automatic score calculation (call this via cron job)
router.post('/calculate-all-scores', async (req, res) => {
  console.log('⏰ Running scheduled score calculation...');
  
  db.getConnection(async (err, connection) => {
    if (err) {
      console.error('❌ Connection error:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }
    
    try {
      const retailers = await queryPromise(
        connection, 
        'SELECT id FROM accounts WHERE role = "retailer"'
      );
      
      console.log(`📊 Calculating scores for ${retailers.length} retailers...`);
      
      const results = [];
      let successCount = 0;
      let errorCount = 0;
      
      // Process in batches to avoid overwhelming the database
      const batchSize = 10;
      for (let i = 0; i < retailers.length; i += batchSize) {
        const batch = retailers.slice(i, i + batchSize);
        
        const batchPromises = batch.map(async (retailer) => {
          try {
            const scoreResult = await calculateRetailerScore(connection, retailer.id, '90');
            results.push({
              retailerId: retailer.id,
              success: true,
              score: scoreResult.score,
              tier: scoreResult.tier
            });
            successCount++;
          } catch (error) {
            console.error(`❌ Failed to score retailer ${retailer.id}:`, error.message);
            results.push({
              retailerId: retailer.id,
              success: false,
              error: error.message
            });
            errorCount++;
          }
        });
        
        await Promise.all(batchPromises);
        console.log(`✅ Processed batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(retailers.length/batchSize)}`);
      }
      
      connection.release();
      
      res.json({
        success: true,
        message: `Scheduled score calculation completed`,
        summary: {
          total: retailers.length,
          success: successCount,
          failed: errorCount,
          timestamp: new Date().toISOString()
        },
        results: results
      });
      
    } catch (error) {
      connection.release();
      console.error('❌ Scheduled calculation error:', error);
      res.status(500).json({ error: 'Scheduled calculation failed', details: error.message });
    }
  });
});

module.exports = router;