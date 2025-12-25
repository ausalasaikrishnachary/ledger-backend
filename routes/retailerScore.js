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


// ============================================
// NEW API: CALCULATE VOLUME & CREDIT RISK SCORE
// ============================================

// POST /api/calculate-volume-credit-score - Calculate score based on volume and credit risk
router.post('/calculate-volume-credit-score', async (req, res) => {
  const { retailerId, period = '90' } = req.body;
  
  console.log('📊 Calculating volume & credit risk score...');
  
  db.getConnection(async (err, connection) => {
    if (err) {
      console.error('❌ Database connection error:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }

    try {
      // If retailerId is provided, calculate for specific retailer
      if (retailerId) {
        const scoreResult = await calculateVolumeCreditScore(connection, retailerId, period);
        
        connection.release();
        
        res.json({
          success: true,
          data: {
            retailerId,
            ...scoreResult
          }
        });
      } else {
        // Calculate for all retailers
        const retailers = await queryPromise(
          connection, 
          'SELECT id, name, business_name FROM accounts WHERE role = "retailer"'
        );
        
        console.log(`📊 Calculating volume/credit scores for ${retailers.length} retailers...`);
        
        const scoringResults = [];
        let successCount = 0;
        let errorCount = 0;
        
        // Process in batches
        const batchSize = 10;
        for (let i = 0; i < retailers.length; i += batchSize) {
          const batch = retailers.slice(i, i + batchSize);
          
          const batchPromises = batch.map(async (retailer) => {
            try {
              const scoreResult = await calculateVolumeCreditScore(connection, retailer.id, period);
              
              // Update accounts table with new score
              await queryPromise(connection, `
                UPDATE accounts 
                SET current_score = ?,
                    score_marks = ?,
                    last_score_calculated = NOW()
                WHERE id = ?
              `, [scoreResult.volumeScore, scoreResult.creditRiskScore, retailer.id]);
              
              scoringResults.push({
                retailerId: retailer.id,
                retailerName: retailer.business_name || retailer.name,
                ...scoreResult
              });
              successCount++;
            } catch (error) {
              console.error(`❌ Failed to score retailer ${retailer.id}:`, error.message);
              scoringResults.push({
                retailerId: retailer.id,
                error: error.message,
                success: false
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
          message: `Volume & credit scores calculated for ${successCount} retailers`,
          summary: {
            total: retailers.length,
            success: successCount,
            failed: errorCount,
            timestamp: new Date().toISOString()
          },
          results: scoringResults
        });
      }
      
    } catch (error) {
      connection.release();
      console.error('❌ Volume/credit score calculation error:', error);
      res.status(500).json({ error: 'Failed to calculate scores', details: error.message });
    }
  });
});

// ============================================
// HELPER FUNCTION: VOLUME & CREDIT RISK SCORING
// ============================================

async function calculateVolumeCreditScore(connection, retailerId, period = '90') {
  try {
    // 1. VOLUME METRICS (from orders table)
    const volumeQuery = `
      SELECT 
        COUNT(*) as total_orders,
        SUM(net_payable) as total_purchase_value,
        AVG(net_payable) as avg_order_value,
        MAX(created_at) as last_order_date,
        MIN(created_at) as first_order_date,
        DATEDIFF(NOW(), MAX(created_at)) as days_since_last_order,
        DATEDIFF(MAX(created_at), MIN(created_at)) as active_period_days,
        AVG(credit_period) as avg_credit_days
      FROM orders 
      WHERE customer_id = ? 
        AND order_status != 'Cancelled'
        AND invoice_status = 1
        AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    
    const volumeData = await queryPromise(connection, volumeQuery, [retailerId, period]);
    const volumeStats = volumeData[0] || {};
    
    // 2. CREDIT RISK METRICS (from voucher table)
    const creditQuery = `
      SELECT 
        COUNT(*) as total_invoices,
        SUM(CASE WHEN balance_amount > 0 THEN 1 ELSE 0 END) as pending_invoices,
        SUM(TotalAmount) as total_billed_amount,
        SUM(paid_amount) as total_paid_amount,
        SUM(balance_amount) as total_balance_amount,
        AVG(CASE WHEN balance_amount > 0 THEN DATEDIFF(NOW(), Date) ELSE 0 END) as avg_pending_days,
        MAX(CASE WHEN balance_amount > 0 THEN DATEDIFF(NOW(), Date) ELSE 0 END) as max_pending_days,
        SUM(CASE WHEN DATEDIFF(NOW(), Date) > 30 AND balance_amount > 0 THEN 1 ELSE 0 END) as overdue_30_days,
        SUM(CASE WHEN DATEDIFF(NOW(), Date) > 60 AND balance_amount > 0 THEN 1 ELSE 0 END) as overdue_60_days
      FROM voucher 
      WHERE PartyID = ? 
        AND TransactionType = 'Sales'
        AND Date >= DATE_SUB(NOW(), INTERVAL ? DAY)
    `;
    
    const creditData = await queryPromise(connection, creditQuery, [retailerId, period]);
    const creditStats = creditData[0] || {};
    
    // 3. ORDER ITEMS DETAILS (for product mix analysis)
    const itemsQuery = `
      SELECT 
        COUNT(DISTINCT oi.product_id) as unique_products,
        COUNT(oi.id) as total_items,
        SUM(oi.item_total) as items_total_value
      FROM order_items oi
      JOIN orders o ON oi.order_number = o.order_number
      WHERE o.customer_id = ?
        AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
        AND o.order_status != 'Cancelled'
    `;
    
    const itemsData = await queryPromise(connection, itemsQuery, [retailerId, period]);
    const itemsStats = itemsData[0] || {};
    
    // 4. CALCULATE VOLUME SCORE (0-100)
    const volumeScore = calculateVolumeScoreComponent(volumeStats, itemsStats);
    
    // 5. CALCULATE CREDIT RISK SCORE (0-100, higher is better)
    const creditRiskScore = calculateCreditRiskScoreComponent(creditStats, volumeStats);
    
    // 6. CALCULATE OVERALL SCORE (Weighted: 70% volume + 30% credit risk)
    const overallScore = Math.round((volumeScore * 0.7) + (creditRiskScore * 0.3));
    
    // 7. DETERMINE RISK CATEGORY
    const riskCategory = determineRiskCategory(creditRiskScore, overallScore);
    
    // 8. DETERMINE TIER BASED ON VOLUME
    const volumeTier = determineVolumeTier(volumeStats.total_purchase_value);
    
    // 9. CALCULATE CREDIT LIMIT SUGGESTION
    const suggestedCreditLimit = calculateSuggestedCreditLimit(
      volumeStats.total_purchase_value, 
      creditRiskScore,
      volumeStats.avg_credit_days
    );
    
    // 10. PREPARE SCORE DETAILS
    const scoreDetails = {
      // Volume metrics
      total_orders: volumeStats.total_orders || 0,
      total_purchase_value: volumeStats.total_purchase_value || 0,
      avg_order_value: volumeStats.avg_order_value || 0,
      avg_credit_days: volumeStats.avg_credit_days || 0,
      days_since_last_order: volumeStats.days_since_last_order || 999,
      unique_products: itemsStats.unique_products || 0,
      total_items: itemsStats.total_items || 0,
      
      // Credit risk metrics
      total_invoices: creditStats.total_invoices || 0,
      pending_invoices: creditStats.pending_invoices || 0,
      total_balance_amount: creditStats.total_balance_amount || 0,
      avg_pending_days: creditStats.avg_pending_days || 0,
      max_pending_days: creditStats.max_pending_days || 0,
      overdue_30_days: creditStats.overdue_30_days || 0,
      overdue_60_days: creditStats.overdue_60_days || 0,
      payment_ratio: creditStats.total_invoices > 0 
        ? ((creditStats.total_paid_amount || 0) / (creditStats.total_billed_amount || 1)) * 100 
        : 0,
      
      // Scores
      volume_score_components: {
        purchase_volume_score: calculatePurchaseVolumeScore(volumeStats.total_purchase_value),
        order_frequency_score: calculateOrderFrequencyScore(volumeStats.total_orders),
        order_value_score: calculateOrderValueScore(volumeStats.avg_order_value),
        recency_score: calculateRecencyScore(volumeStats.days_since_last_order),
        product_diversity_score: calculateProductDiversityScore(
          itemsStats.unique_products, 
          itemsStats.total_items
        )
      },
      
      credit_risk_components: {
        pending_ratio_score: calculatePendingRatioScore(
          creditStats.pending_invoices, 
          creditStats.total_invoices
        ),
        payment_delay_score: calculatePaymentDelayScore(creditStats.avg_pending_days),
        overdue_score: calculateOverdueScore(
          creditStats.overdue_30_days,
          creditStats.overdue_60_days
        ),
        credit_utilization_score: calculateCreditUtilizationScore(
          creditStats.total_balance_amount,
          volumeStats.total_purchase_value
        )
      },
      
      calculation_period: period,
      calculated_at: new Date().toISOString()
    };
    
    return {
      volumeScore: Math.round(volumeScore),
      creditRiskScore: Math.round(creditRiskScore),
      overallScore: overallScore,
      riskCategory: riskCategory,
      volumeTier: volumeTier,
      suggestedCreditLimit: suggestedCreditLimit,
      details: scoreDetails
    };
    
  } catch (error) {
    console.error(`❌ Error calculating volume/credit score for retailer ${retailerId}:`, error);
    throw error;
  }
}

// ============================================
// SCORING COMPONENT FUNCTIONS
// ============================================

function calculateVolumeScoreComponent(volumeStats, itemsStats) {
  let score = 0;
  const weights = {
    purchaseVolume: 40,    // 40%
    orderFrequency: 25,    // 25%
    orderValue: 20,        // 20%
    recency: 10,           // 10%
    diversity: 5           // 5%
  };
  
  // 1. Purchase Volume (0-40 points)
  const purchaseVolume = volumeStats.total_purchase_value || 0;
  if (purchaseVolume >= 1000000) score += 40;
  else if (purchaseVolume >= 500000) score += 35;
  else if (purchaseVolume >= 250000) score += 30;
  else if (purchaseVolume >= 100000) score += 25;
  else if (purchaseVolume >= 50000) score += 20;
  else if (purchaseVolume >= 25000) score += 15;
  else if (purchaseVolume >= 10000) score += 10;
  else if (purchaseVolume >= 5000) score += 5;
  else if (purchaseVolume >= 1000) score += 2;
  
  // 2. Order Frequency (0-25 points)
  const orderCount = volumeStats.total_orders || 0;
  if (orderCount >= 50) score += 25;
  else if (orderCount >= 30) score += 22;
  else if (orderCount >= 20) score += 18;
  else if (orderCount >= 15) score += 15;
  else if (orderCount >= 10) score += 12;
  else if (orderCount >= 5) score += 8;
  else if (orderCount >= 3) score += 5;
  else if (orderCount >= 1) score += 2;
  
  // 3. Average Order Value (0-20 points)
  const avgOrderValue = volumeStats.avg_order_value || 0;
  if (avgOrderValue >= 50000) score += 20;
  else if (avgOrderValue >= 25000) score += 17;
  else if (avgOrderValue >= 15000) score += 14;
  else if (avgOrderValue >= 10000) score += 11;
  else if (avgOrderValue >= 5000) score += 8;
  else if (avgOrderValue >= 2500) score += 5;
  else if (avgOrderValue >= 1000) score += 2;
  
  // 4. Recency (0-10 points)
  const daysSinceLastOrder = volumeStats.days_since_last_order || 999;
  if (daysSinceLastOrder <= 7) score += 10;
  else if (daysSinceLastOrder <= 15) score += 8;
  else if (daysSinceLastOrder <= 30) score += 6;
  else if (daysSinceLastOrder <= 45) score += 4;
  else if (daysSinceLastOrder <= 60) score += 2;
  else if (daysSinceLastOrder <= 90) score += 1;
  
  // 5. Product Diversity (0-5 points)
  const uniqueProducts = itemsStats.unique_products || 0;
  if (uniqueProducts >= 20) score += 5;
  else if (uniqueProducts >= 15) score += 4;
  else if (uniqueProducts >= 10) score += 3;
  else if (uniqueProducts >= 5) score += 2;
  else if (uniqueProducts >= 2) score += 1;
  
  return Math.min(100, score);
}

function calculateCreditRiskScoreComponent(creditStats, volumeStats) {
  let score = 100; // Start with perfect score, deduct for risks
  
  // 1. Deduct for pending invoice ratio
  const totalInvoices = creditStats.total_invoices || 1;
  const pendingRatio = (creditStats.pending_invoices || 0) / totalInvoices;
  
  if (pendingRatio > 0.5) score -= 40;
  else if (pendingRatio > 0.3) score -= 30;
  else if (pendingRatio > 0.2) score -= 20;
  else if (pendingRatio > 0.1) score -= 10;
  else if (pendingRatio > 0.05) score -= 5;
  
  // 2. Deduct for payment delays
  const avgPendingDays = creditStats.avg_pending_days || 0;
  if (avgPendingDays > 60) score -= 30;
  else if (avgPendingDays > 45) score -= 20;
  else if (avgPendingDays > 30) score -= 15;
  else if (avgPendingDays > 15) score -= 10;
  else if (avgPendingDays > 7) score -= 5;
  
  // 3. Deduct for overdue invoices
  const overdue30 = creditStats.overdue_30_days || 0;
  const overdue60 = creditStats.overdue_60_days || 0;
  
  if (overdue60 > 2) score -= 25;
  else if (overdue60 > 0) score -= 15;
  
  if (overdue30 > 3) score -= 20;
  else if (overdue30 > 1) score -= 10;
  
  // 4. Deduct for high credit utilization
  const totalPurchase = volumeStats.total_purchase_value || 1;
  const balanceRatio = (creditStats.total_balance_amount || 0) / totalPurchase;
  
  if (balanceRatio > 0.5) score -= 20;
  else if (balanceRatio > 0.3) score -= 15;
  else if (balanceRatio > 0.2) score -= 10;
  else if (balanceRatio > 0.1) score -= 5;
  
  // 5. Bonus for good payment behavior
  if (pendingRatio < 0.05 && avgPendingDays < 7) {
    score += 10; // Bonus for excellent payment
  }
  
  return Math.max(0, Math.min(100, score));
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function calculatePurchaseVolumeScore(totalPurchase) {
  if (totalPurchase >= 1000000) return 40;
  if (totalPurchase >= 500000) return 35;
  if (totalPurchase >= 250000) return 30;
  if (totalPurchase >= 100000) return 25;
  if (totalPurchase >= 50000) return 20;
  if (totalPurchase >= 25000) return 15;
  if (totalPurchase >= 10000) return 10;
  if (totalPurchase >= 5000) return 5;
  if (totalPurchase >= 1000) return 2;
  return 0;
}

function calculateOrderFrequencyScore(orderCount) {
  if (orderCount >= 50) return 25;
  if (orderCount >= 30) return 22;
  if (orderCount >= 20) return 18;
  if (orderCount >= 15) return 15;
  if (orderCount >= 10) return 12;
  if (orderCount >= 5) return 8;
  if (orderCount >= 3) return 5;
  if (orderCount >= 1) return 2;
  return 0;
}

function calculateOrderValueScore(avgOrderValue) {
  if (avgOrderValue >= 50000) return 20;
  if (avgOrderValue >= 25000) return 17;
  if (avgOrderValue >= 15000) return 14;
  if (avgOrderValue >= 10000) return 11;
  if (avgOrderValue >= 5000) return 8;
  if (avgOrderValue >= 2500) return 5;
  if (avgOrderValue >= 1000) return 2;
  return 0;
}

function calculateRecencyScore(daysSinceLastOrder) {
  if (daysSinceLastOrder <= 7) return 10;
  if (daysSinceLastOrder <= 15) return 8;
  if (daysSinceLastOrder <= 30) return 6;
  if (daysSinceLastOrder <= 45) return 4;
  if (daysSinceLastOrder <= 60) return 2;
  if (daysSinceLastOrder <= 90) return 1;
  return 0;
}

function calculateProductDiversityScore(uniqueProducts, totalItems) {
  if (totalItems === 0) return 0;
  if (uniqueProducts >= 20) return 5;
  if (uniqueProducts >= 15) return 4;
  if (uniqueProducts >= 10) return 3;
  if (uniqueProducts >= 5) return 2;
  if (uniqueProducts >= 2) return 1;
  return 0;
}

function calculatePendingRatioScore(pendingInvoices, totalInvoices) {
  if (totalInvoices === 0) return 100;
  const pendingRatio = pendingInvoices / totalInvoices;
  if (pendingRatio <= 0.05) return 100;
  if (pendingRatio <= 0.1) return 90;
  if (pendingRatio <= 0.2) return 80;
  if (pendingRatio <= 0.3) return 70;
  if (pendingRatio <= 0.4) return 60;
  if (pendingRatio <= 0.5) return 50;
  return 40;
}

function calculatePaymentDelayScore(avgPendingDays) {
  if (avgPendingDays <= 7) return 100;
  if (avgPendingDays <= 15) return 90;
  if (avgPendingDays <= 30) return 80;
  if (avgPendingDays <= 45) return 70;
  if (avgPendingDays <= 60) return 60;
  return 50;
}

function calculateOverdueScore(overdue30, overdue60) {
  if (overdue60 === 0 && overdue30 === 0) return 100;
  if (overdue60 === 0 && overdue30 <= 1) return 80;
  if (overdue60 === 0 && overdue30 <= 3) return 60;
  if (overdue60 <= 1) return 40;
  return 20;
}

function calculateCreditUtilizationScore(totalBalance, totalPurchase) {
  if (totalPurchase === 0) return 100;
  const utilizationRatio = totalBalance / totalPurchase;
  if (utilizationRatio <= 0.1) return 100;
  if (utilizationRatio <= 0.2) return 90;
  if (utilizationRatio <= 0.3) return 80;
  if (utilizationRatio <= 0.4) return 70;
  if (utilizationRatio <= 0.5) return 60;
  return 50;
}

function determineRiskCategory(creditScore, overallScore) {
  if (creditScore >= 80 && overallScore >= 70) return 'Low Risk';
  if (creditScore >= 60 && overallScore >= 50) return 'Moderate Risk';
  if (creditScore >= 40 && overallScore >= 30) return 'High Risk';
  return 'Very High Risk';
}

function determineVolumeTier(totalPurchase) {
  if (totalPurchase >= 500000) return 'Platinum';
  if (totalPurchase >= 250000) return 'Gold';
  if (totalPurchase >= 100000) return 'Silver';
  if (totalPurchase >= 50000) return 'Bronze';
  if (totalPurchase >= 10000) return 'Standard';
  return 'Basic';
}

function calculateSuggestedCreditLimit(totalPurchase, creditScore, avgCreditDays) {
  // Base limit on 30% of quarterly purchases
  let baseLimit = totalPurchase * 0.3;
  
  // Adjust based on credit score
  const creditScoreMultiplier = creditScore / 100;
  baseLimit = baseLimit * creditScoreMultiplier;
  
  // Adjust based on credit days (shorter credit = higher limit)
  let creditDayMultiplier = 1;
  if (avgCreditDays <= 15) creditDayMultiplier = 1.5;
  else if (avgCreditDays <= 30) creditDayMultiplier = 1.2;
  else if (avgCreditDays > 45) creditDayMultiplier = 0.8;
  
  baseLimit = baseLimit * creditDayMultiplier;
  
  // Round to nearest 5000
  const roundedLimit = Math.round(baseLimit / 5000) * 5000;
  
  // Ensure minimum limit of 5000
  return Math.max(5000, roundedLimit);
}

// ============================================
// GET API FOR RETAILER VOLUME/CREDIT SCORE
// ============================================

// GET /api/retailer-volume-credit-score/:retailerId - Get specific retailer's volume/credit score
router.get('/retailer-volume-credit-score/:retailerId', async (req, res) => {
  const { retailerId } = req.params;
  const { period = '90' } = req.query;
  
  db.getConnection(async (err, connection) => {
    if (err) {
      console.error('❌ Database connection error:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }
    
    try {
      // Get retailer basic info
      const retailerQuery = `
        SELECT 
          id, name, business_name, email, mobile_number, gstin,
          credit_limit, status, opening_balance,
          score, score_tier, current_score, score_marks
        FROM accounts 
        WHERE id = ? AND role = 'retailer'
      `;
      
      const retailerData = await queryPromise(connection, retailerQuery, [retailerId]);
      
      if (retailerData.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Retailer not found' });
      }
      
      const retailer = retailerData[0];
      
      // Calculate volume/credit score
      const scoreResult = await calculateVolumeCreditScore(connection, retailerId, period);
      
      // Get additional metrics
      const additionalMetrics = await getRetailerAdditionalMetrics(connection, retailerId, period);
      
      connection.release();
      
      res.json({
        success: true,
        data: {
          retailerInfo: {
            id: retailer.id,
            name: retailer.name,
            business_name: retailer.business_name,
            contact: {
              email: retailer.email,
              mobile: retailer.mobile_number
            },
            registration: {
              gstin: retailer.gstin,
              status: retailer.status
            },
            financials: {
              opening_balance: retailer.opening_balance,
              current_credit_limit: retailer.credit_limit
            }
          },
          scores: {
            ...scoreResult,
            existing_score: retailer.score,
            existing_tier: retailer.score_tier,
            current_score: retailer.current_score,
            score_marks: retailer.score_marks
          },
          additionalMetrics,
          recommendations: generateRecommendations(scoreResult, additionalMetrics)
        }
      });
      
    } catch (error) {
      connection.release();
      console.error('❌ Error fetching volume/credit score:', error);
      res.status(500).json({ error: 'Failed to fetch score', details: error.message });
    }
  });
});

// Helper function for additional metrics
async function getRetailerAdditionalMetrics(connection, retailerId, period) {
  // Growth metrics
  const growthQuery = `
    SELECT 
      DATE_FORMAT(created_at, '%Y-%m') as month,
      COUNT(*) as order_count,
      SUM(net_payable) as monthly_total,
      AVG(net_payable) as avg_order_value
    FROM orders
    WHERE customer_id = ?
      AND order_status != 'Cancelled'
      AND invoice_status = 1
      AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
    GROUP BY DATE_FORMAT(created_at, '%Y-%m')
    ORDER BY month
  `;
  
  const growthData = await queryPromise(connection, growthQuery, [retailerId]);
  
  // Product category analysis
  const categoryQuery = `
    SELECT 
      p.category,
      COUNT(oi.id) as item_count,
      SUM(oi.item_total) as category_total
    FROM order_items oi
    JOIN orders o ON oi.order_number = o.order_number
    JOIN products p ON oi.product_id = p.id
    WHERE o.customer_id = ?
      AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      AND o.order_status != 'Cancelled'
    GROUP BY p.category
    ORDER BY category_total DESC
    LIMIT 5
  `;
  
  const categoryData = await queryPromise(connection, categoryQuery, [retailerId, period]);
  
  // Payment pattern analysis
  const paymentPatternQuery = `
    SELECT 
      CASE 
        WHEN DATEDIFF(NOW(), Date) <= 7 THEN '0-7 days'
        WHEN DATEDIFF(NOW(), Date) <= 15 THEN '8-15 days'
        WHEN DATEDIFF(NOW(), Date) <= 30 THEN '16-30 days'
        WHEN DATEDIFF(NOW(), Date) <= 45 THEN '31-45 days'
        WHEN DATEDIFF(NOW(), Date) <= 60 THEN '46-60 days'
        ELSE '60+ days'
      END as payment_delay_range,
      COUNT(*) as invoice_count,
      SUM(TotalAmount) as total_amount
    FROM voucher
    WHERE PartyID = ?
      AND TransactionType = 'Sales'
      AND balance_amount > 0
      AND Date >= DATE_SUB(NOW(), INTERVAL 180 DAY)
    GROUP BY payment_delay_range
    ORDER BY MIN(DATEDIFF(NOW(), Date))
  `;
  
  const paymentPatternData = await queryPromise(connection, paymentPatternQuery, [retailerId]);
  
  return {
    growthTrend: growthData,
    topCategories: categoryData,
    paymentPatterns: paymentPatternData,
    analysisPeriod: `${period} days`
  };
}

// Generate recommendations based on scores
function generateRecommendations(scoreResult, additionalMetrics) {
  const recommendations = [];
  
  if (scoreResult.creditRiskScore < 60) {
    recommendations.push({
      type: 'CREDIT_RISK',
      priority: 'HIGH',
      message: 'High credit risk detected. Consider reducing credit limit or requiring advance payments.',
      action: 'Review payment terms and implement stricter credit controls.'
    });
  }
  
  if (scoreResult.volumeScore < 50) {
    recommendations.push({
      type: 'VOLUME_GROWTH',
      priority: 'MEDIUM',
      message: 'Purchase volume is below optimal levels. This retailer has growth potential.',
      action: 'Offer targeted promotions or bulk discounts to increase order frequency.'
    });
  }
  
  if (scoreResult.details?.days_since_last_order > 60) {
    recommendations.push({
      type: 'RECENCY',
      priority: 'MEDIUM',
      message: `No purchases in ${scoreResult.details.days_since_last_order} days. Risk of attrition.`,
      action: 'Schedule follow-up call and offer reactivation discount.'
    });
  }
  
  if (scoreResult.details?.pending_invoices > 0 && scoreResult.details.pending_ratio > 0.3) {
    recommendations.push({
      type: 'PAYMENT_DELAY',
      priority: 'HIGH',
      message: `${Math.round(scoreResult.details.pending_ratio * 100)}% invoices pending payment.`,
      action: 'Send payment reminders and consider temporary hold on new credit.'
    });
  }
  
  // Add positive recommendations for good scores
  if (scoreResult.creditRiskScore >= 80 && scoreResult.volumeScore >= 70) {
    recommendations.push({
      type: 'PERFORMANCE',
      priority: 'LOW',
      message: 'Excellent performer. Consider premium tier benefits.',
      action: 'Offer loyalty discounts or early access to new products.'
    });
  }
  
  return recommendations;
}


// ============================================
// GET API: FETCH VOLUME & CREDIT RISK SCORES
// ============================================

// GET /api/volume-credit-scores - Fetch calculated volume/credit scores with filters
router.get('/volume-credit-scores', async (req, res) => {
  const { 
    page = 1, 
    limit = 50, 
    riskCategory, 
    volumeTier,
    minVolumeScore = 0,
    maxVolumeScore = 100,
    minCreditScore = 0,
    maxCreditScore = 100,
    sortBy = 'overallScore',
    sortOrder = 'DESC',
    period = '90'
  } = req.query;
  
  const offset = (page - 1) * limit;
  
  console.log('📊 Fetching volume/credit scores with filters:', req.query);
  
  db.getConnection(async (err, connection) => {
    if (err) {
      console.error('❌ Database connection error:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }
    
    try {
      // Build base query
      let baseQuery = `
        SELECT 
          a.id,
          a.name,
          a.business_name,
          a.email,
          a.mobile_number,
          a.gstin,
          a.credit_limit,
          a.status,
          a.opening_balance,
          a.score as existing_composite_score,
          a.score_tier as existing_tier,
          a.current_score as volume_score,
          a.score_marks as credit_risk_score,
          a.last_score_calculated,
          a.assigned_staff,
          a.discount,
          a.Target,
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')), 0) as total_purchases,
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.order_count')), 0) as order_count,
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.last_order_date')), NULL) as last_order_date,
          COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.avg_order_value')), 0) as avg_order_value
        FROM accounts a
        WHERE a.role = 'retailer'
          AND a.current_score IS NOT NULL
          AND a.score_marks IS NOT NULL
      `;
      
      let queryParams = [];
      
      // Add filters
      if (riskCategory) {
        // This filter would require calculating on the fly or storing risk category
        // For now, we'll filter by credit risk score ranges
        if (riskCategory === 'Low Risk') {
          baseQuery += ' AND a.score_marks >= 80';
        } else if (riskCategory === 'Moderate Risk') {
          baseQuery += ' AND a.score_marks >= 60 AND a.score_marks < 80';
        } else if (riskCategory === 'High Risk') {
          baseQuery += ' AND a.score_marks >= 40 AND a.score_marks < 60';
        } else if (riskCategory === 'Very High Risk') {
          baseQuery += ' AND a.score_marks < 40';
        }
      }
      
      // Filter by volume tier
      // if (volumeTier) {
      //   if (volumeTier === 'Platinum') {
      //     baseQuery += ' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')), 0) >= 500000';
      //   } else if (volumeTier === 'Gold') {
      //     baseQuery += ' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')), 0) >= 250000 ' +
      //                  'AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')), 0) < 500000';
      //   } else if (volumeTier === 'Silver') {
      //     baseQuery += ' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')), 0) >= 100000 ' +
      //                  'AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')), 0) < 250000';
      //   } else if (volumeTier === 'Bronze') {
      //     baseQuery += ' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')), 0) >= 50000 ' +
      //                  'AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')), 0) < 100000';
      //   }
      // }
      
      // Score range filters
      baseQuery += ' AND a.current_score >= ? AND a.current_score <= ?';
      queryParams.push(parseInt(minVolumeScore), parseInt(maxVolumeScore));
      
      baseQuery += ' AND a.score_marks >= ? AND a.score_marks <= ?';
      queryParams.push(parseInt(minCreditScore), parseInt(maxCreditScore));
      
      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM (${baseQuery}) as filtered`;
      const countResult = await queryPromise(connection, countQuery, queryParams);
      const total = countResult[0].total;
      
      // Add sorting
      const validSortColumns = [
        'volume_score', 'credit_risk_score', 'business_name', 
        'total_purchases', 'order_count', 'last_score_calculated'
      ];
      
      let sortColumn = 'a.current_score'; // default
      if (sortBy === 'creditScore') {
        sortColumn = 'a.score_marks';
      } else if (sortBy === 'volumeScore') {
        sortColumn = 'a.current_score';
      }
      //  else if (sortBy === 'totalPurchases') {
      //   sortColumn = 'COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.total_purchases')), 0)';
      // }
      //  else if (sortBy === 'orderCount') {
      //   sortColumn = 'COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.score_details, '$.order_count')), 0)';
      // }
       else if (sortBy === 'lastUpdated') {
        sortColumn = 'a.last_score_calculated';
      } else if (sortBy === 'name') {
        sortColumn = 'a.business_name';
      }
      
      // Add pagination and finalize query
      const finalQuery = `
        ${baseQuery}
        ORDER BY ${sortColumn} ${sortOrder === 'DESC' ? 'DESC' : 'ASC'}
        LIMIT ? OFFSET ?
      `;
      
      const finalParams = [...queryParams, parseInt(limit), parseInt(offset)];
      
      const results = await queryPromise(connection, finalQuery, finalParams);
      
      // Calculate overall score and additional metrics for each retailer
      const enhancedResults = results.map(retailer => {
        const volumeScore = retailer.volume_score || 0;
        const creditScore = retailer.credit_risk_score || 0;
        const overallScore = Math.round((volumeScore * 0.7) + (creditScore * 0.3));
        
        // Determine risk category
        let riskCategory = 'Very High Risk';
        if (creditScore >= 80 && overallScore >= 70) riskCategory = 'Low Risk';
        else if (creditScore >= 60 && overallScore >= 50) riskCategory = 'Moderate Risk';
        else if (creditScore >= 40 && overallScore >= 30) riskCategory = 'High Risk';
        
        // Determine volume tier
        const totalPurchase = parseFloat(retailer.total_purchases) || 0;
        let volumeTier = 'Basic';
        if (totalPurchase >= 500000) volumeTier = 'Platinum';
        else if (totalPurchase >= 250000) volumeTier = 'Gold';
        else if (totalPurchase >= 100000) volumeTier = 'Silver';
        else if (totalPurchase >= 50000) volumeTier = 'Bronze';
        else if (totalPurchase >= 10000) volumeTier = 'Standard';
        
        // Calculate suggested credit limit
        const suggestedCreditLimit = calculateSuggestedCreditLimit(
          totalPurchase,
          creditScore,
          30 // default avg credit days
        );
        
        // Days since last order
        let daysSinceLastOrder = null;
        if (retailer.last_order_date) {
          const lastOrderDate = new Date(retailer.last_order_date);
          daysSinceLastOrder = Math.floor((new Date() - lastOrderDate) / (1000 * 60 * 60 * 24));
        }
        
        // Performance indicators
        const performanceIndicators = {
          volumeStrength: volumeScore >= 70 ? 'High' : volumeScore >= 50 ? 'Medium' : 'Low',
          creditRisk: creditScore >= 80 ? 'Low' : creditScore >= 60 ? 'Moderate' : creditScore >= 40 ? 'High' : 'Very High',
          growthPotential: totalPurchase > 0 && parseFloat(retailer.avg_order_value) > 10000 ? 'High' : 'Medium',
          paymentReliability: creditScore >= 70 ? 'Good' : creditScore >= 50 ? 'Fair' : 'Poor'
        };
        
        return {
          ...retailer,
          scores: {
            volumeScore: Math.round(volumeScore),
            creditRiskScore: Math.round(creditScore),
            overallScore: overallScore,
            riskCategory: riskCategory,
            volumeTier: volumeTier,
            suggestedCreditLimit: suggestedCreditLimit,
            existingCompositeScore: retailer.existing_composite_score,
            existingTier: retailer.existing_tier
          },
          metrics: {
            totalPurchases: totalPurchase,
            orderCount: parseInt(retailer.order_count) || 0,
            avgOrderValue: parseFloat(retailer.avg_order_value) || 0,
            daysSinceLastOrder: daysSinceLastOrder,
            currentCreditUtilization: retailer.credit_limit ? 
              (totalPurchase / retailer.credit_limit) * 100 : 0
          },
          performanceIndicators: performanceIndicators,
          lastUpdated: retailer.last_score_calculated
        };
      });
      
      // Calculate summary statistics
      const summaryStats = {
        totalRetailers: total,
        avgVolumeScore: enhancedResults.reduce((sum, r) => sum + r.scores.volumeScore, 0) / enhancedResults.length || 0,
        avgCreditScore: enhancedResults.reduce((sum, r) => sum + r.scores.creditRiskScore, 0) / enhancedResults.length || 0,
        avgOverallScore: enhancedResults.reduce((sum, r) => sum + r.scores.overallScore, 0) / enhancedResults.length || 0,
        totalPurchaseVolume: enhancedResults.reduce((sum, r) => sum + r.metrics.totalPurchases, 0),
        totalOrders: enhancedResults.reduce((sum, r) => sum + r.metrics.orderCount, 0)
      };
      
      // Risk distribution
      const riskDistribution = enhancedResults.reduce((acc, retailer) => {
        acc[retailer.scores.riskCategory] = (acc[retailer.scores.riskCategory] || 0) + 1;
        return acc;
      }, {});
      
      // Tier distribution
      const tierDistribution = enhancedResults.reduce((acc, retailer) => {
        acc[retailer.scores.volumeTier] = (acc[retailer.scores.volumeTier] || 0) + 1;
        return acc;
      }, {});
      
      connection.release();
      
      res.json({
        success: true,
        data: enhancedResults,
        summary: {
          stats: summaryStats,
          riskDistribution: riskDistribution,
          tierDistribution: tierDistribution,
          analysisPeriod: `${period} days`
        },
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: total,
          totalPages: Math.ceil(total / limit)
        },
        filtersApplied: {
          riskCategory: riskCategory || 'All',
          volumeTier: volumeTier || 'All',
          volumeScoreRange: `${minVolumeScore}-${maxVolumeScore}`,
          creditScoreRange: `${minCreditScore}-${maxCreditScore}`,
          sortBy: sortBy,
          sortOrder: sortOrder
        }
      });
      
    } catch (error) {
      connection.release();
      console.error('❌ Error fetching volume/credit scores:', error);
      res.status(500).json({ 
        error: 'Failed to fetch volume/credit scores', 
        details: error.message 
      });
    }
  });
});

// ============================================
// GET API FOR SINGLE RETAILER'S VOLUME/CREDIT SCORE
// ============================================

// GET /api/retailer/:id/volume-credit-score - Get detailed volume/credit score for specific retailer
router.get('/retailer/:id/volume-credit-score', async (req, res) => {
  const retailerId = req.params.id;
  const { period = '90', recalculate = 'false' } = req.query;
  
  console.log(`📊 Fetching volume/credit score for retailer ${retailerId}`);
  
  db.getConnection(async (err, connection) => {
    if (err) {
      console.error('❌ Database connection error:', err);
      return res.status(500).json({ error: 'Database connection failed' });
    }
    
    try {
      // Get retailer basic info
      const retailerQuery = `
        SELECT 
          id, name, business_name, email, mobile_number, gstin,
          credit_limit, status, opening_balance, account_group_id,
          score, score_tier, current_score, score_marks,
          score_details, last_score_calculated,
          assigned_staff, discount, Target,
          shipping_state, billing_state
        FROM accounts 
        WHERE id = ? AND role = 'retailer'
      `;
      
      const retailerData = await queryPromise(connection, retailerQuery, [retailerId]);
      
      if (retailerData.length === 0) {
        connection.release();
        return res.status(404).json({ error: 'Retailer not found or not a retailer account' });
      }
      
      const retailer = retailerData[0];
      
      let scoreResult;
      
      // Recalculate if requested or if scores are stale
      const shouldRecalculate = recalculate === 'true' || 
                               !retailer.current_score || 
                               !retailer.score_marks ||
                               !retailer.last_score_calculated ||
                               Date.now() - new Date(retailer.last_score_calculated).getTime() > 7 * 24 * 60 * 60 * 1000; // 7 days
      
      if (shouldRecalculate) {
        console.log(`🔄 Recalculating scores for retailer ${retailerId}`);
        scoreResult = await calculateVolumeCreditScore(connection, retailerId, period);
        
        // Update the retailer's scores in database
        await queryPromise(connection, `
          UPDATE accounts 
          SET current_score = ?,
              score_marks = ?,
              score_details = ?,
              last_score_calculated = NOW()
          WHERE id = ?
        `, [
          scoreResult.volumeScore,
          scoreResult.creditRiskScore,
          JSON.stringify(scoreResult.details),
          retailerId
        ]);
        
        // Refresh retailer data with updated scores
        const updatedRetailerData = await queryPromise(connection, retailerQuery, [retailerId]);
        Object.assign(retailer, updatedRetailerData[0]);
      } else {
        // Use existing scores from database
        scoreResult = {
          volumeScore: retailer.current_score || 0,
          creditRiskScore: retailer.score_marks || 0,
          overallScore: Math.round(((retailer.current_score || 0) * 0.7) + ((retailer.score_marks || 0) * 0.3)),
          riskCategory: determineRiskCategory(retailer.score_marks || 0, retailer.current_score || 0),
          volumeTier: determineVolumeTier(
            retailer.score_details ? 
            JSON.parse(retailer.score_details).total_purchases || 0 : 0
          ),
          suggestedCreditLimit: calculateSuggestedCreditLimit(
            retailer.score_details ? 
            JSON.parse(retailer.score_details).total_purchases || 0 : 0,
            retailer.score_marks || 0,
            retailer.score_details ? 
            JSON.parse(retailer.score_details).avg_credit_days || 30 : 30
          ),
          details: retailer.score_details ? JSON.parse(retailer.score_details) : {}
        };
      }
      
      // Get detailed metrics and analysis
      const detailedMetrics = await getRetailerDetailedMetrics(connection, retailerId, period);
      
      // Get recent orders for activity timeline
      const recentOrders = await queryPromise(connection, `
        SELECT 
          order_number,
          created_at,
          net_payable,
          credit_period,
          order_status,
          invoice_status,
          assigned_staff
        FROM orders
        WHERE customer_id = ?
        ORDER BY created_at DESC
        LIMIT 10
      `, [retailerId]);
      
      // Get payment history
      const paymentHistory = await queryPromise(connection, `
        SELECT 
          InvoiceNumber,
          Date,
          TotalAmount,
          paid_amount,
          balance_amount,
          status,
          DATEDIFF(NOW(), Date) as days_pending
        FROM voucher
        WHERE PartyID = ?
          AND TransactionType = 'Sales'
        ORDER BY Date DESC
        LIMIT 10
      `, [retailerId]);
      
      // Calculate growth trend
      const growthTrend = await calculateGrowthTrend(connection, retailerId);
      
      // Generate insights and recommendations
      const insights = generateRetailerInsights(scoreResult, detailedMetrics, retailer);
      const recommendations = generateActionableRecommendations(scoreResult, detailedMetrics);
      
      connection.release();
      
      res.json({
        success: true,
        retailer: {
          id: retailer.id,
          name: retailer.name,
          businessName: retailer.business_name,
          contact: {
            email: retailer.email,
            mobile: retailer.mobile_number
          },
          location: {
            shippingState: retailer.shipping_state,
            billingState: retailer.billing_state
          },
          financial: {
            gstin: retailer.gstin,
            status: retailer.status,
            creditLimit: retailer.credit_limit,
            openingBalance: retailer.opening_balance,
            assignedStaff: retailer.assigned_staff,
            discount: retailer.discount,
            target: retailer.Target
          }
        },
        scores: {
          volumeScore: Math.round(scoreResult.volumeScore),
          creditRiskScore: Math.round(scoreResult.creditRiskScore),
          overallScore: scoreResult.overallScore,
          riskCategory: scoreResult.riskCategory,
          volumeTier: scoreResult.volumeTier,
          suggestedCreditLimit: scoreResult.suggestedCreditLimit,
          existingCompositeScore: retailer.score,
          existingTier: retailer.score_tier,
          lastCalculated: retailer.last_score_calculated,
          calculationPeriod: `${period} days`,
          recalculated: shouldRecalculate
        },
        metrics: {
          ...detailedMetrics,
          growthTrend: growthTrend,
          recentActivity: {
            orders: recentOrders,
            payments: paymentHistory
          }
        },
        insights: insights,
        recommendations: recommendations,
        scoreBreakdown: scoreResult.details,
        exportable: {
          csvUrl: `/api/export/retailer/${retailerId}/volume-credit-score.csv`,
          pdfUrl: `/api/export/retailer/${retailerId}/volume-credit-score.pdf`
        }
      });
      
    } catch (error) {
      connection.release();
      console.error(`❌ Error fetching volume/credit score for retailer ${retailerId}:`, error);
      res.status(500).json({ 
        error: 'Failed to fetch retailer volume/credit score', 
        details: error.message 
      });
    }
  });
});

// ============================================
// HELPER FUNCTIONS FOR GET APIS
// ============================================

async function getRetailerDetailedMetrics(connection, retailerId, period) {
  const metrics = {};
  
  // 1. Get volume metrics
  const volumeMetrics = await queryPromise(connection, `
    SELECT 
      COUNT(*) as total_orders,
      SUM(net_payable) as total_purchase_value,
      AVG(net_payable) as avg_order_value,
      MIN(created_at) as first_order_date,
      MAX(created_at) as last_order_date,
      AVG(credit_period) as avg_credit_days,
      DATEDIFF(NOW(), MAX(created_at)) as days_since_last_order
    FROM orders
    WHERE customer_id = ?
      AND order_status != 'Cancelled'
      AND invoice_status = 1
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
  `, [retailerId, period]);
  
  metrics.volume = volumeMetrics[0] || {};
  
  // 2. Get credit metrics
  const creditMetrics = await queryPromise(connection, `
    SELECT 
      COUNT(*) as total_invoices,
      SUM(CASE WHEN balance_amount > 0 THEN 1 ELSE 0 END) as pending_invoices,
      SUM(TotalAmount) as total_billed,
      SUM(paid_amount) as total_paid,
      SUM(balance_amount) as total_balance,
      AVG(CASE WHEN balance_amount > 0 THEN DATEDIFF(NOW(), Date) ELSE NULL END) as avg_pending_days,
      MAX(CASE WHEN balance_amount > 0 THEN DATEDIFF(NOW(), Date) ELSE 0 END) as max_pending_days,
      SUM(CASE WHEN DATEDIFF(NOW(), Date) > 60 AND balance_amount > 0 THEN 1 ELSE 0 END) as overdue_60plus
    FROM voucher
    WHERE PartyID = ?
      AND TransactionType = 'Sales'
      AND Date >= DATE_SUB(NOW(), INTERVAL ? DAY)
  `, [retailerId, period]);
  
  metrics.credit = creditMetrics[0] || {};
  
  // 3. Get product mix
  const productMix = await queryPromise(connection, `
    SELECT 
      COUNT(DISTINCT oi.product_id) as unique_products,
      COUNT(oi.id) as total_items,
      AVG(oi.price) as avg_item_price,
      SUM(oi.quantity) as total_quantity
    FROM order_items oi
    JOIN orders o ON oi.order_number = o.order_number
    WHERE o.customer_id = ?
      AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
      AND o.order_status != 'Cancelled'
  `, [retailerId, period]);
  
  metrics.product = productMix[0] || {};
  
  // 4. Calculate derived metrics
  metrics.derived = {
    purchaseFrequency: metrics.volume.total_orders > 0 ? 
      period / metrics.volume.total_orders : 0, // days between orders
    paymentEfficiency: metrics.credit.total_billed > 0 ? 
      (metrics.credit.total_paid / metrics.credit.total_billed) * 100 : 100,
    creditUtilization: metrics.volume.total_purchase_value > 0 ? 
      (metrics.credit.total_balance / metrics.volume.total_purchase_value) * 100 : 0,
    orderStability: calculateOrderStability(connection, retailerId, period)
  };
  
  return metrics;
}

async function calculateOrderStability(connection, retailerId, period) {
  // Calculate coefficient of variation for order values
  const orderValues = await queryPromise(connection, `
    SELECT net_payable
    FROM orders
    WHERE customer_id = ?
      AND order_status != 'Cancelled'
      AND invoice_status = 1
      AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
  `, [retailerId, period]);
  
  if (orderValues.length < 2) return 100; // High stability if few orders
  
  const values = orderValues.map(o => parseFloat(o.net_payable) || 0);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? (stdDev / mean) * 100 : 0;
  
  // Convert to stability score (0-100)
  return Math.max(0, 100 - cv);
}

async function calculateGrowthTrend(connection, retailerId) {
  const trends = await queryPromise(connection, `
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
  `, [retailerId]);
  
  if (trends.length < 2) {
    return { trend: 'insufficient_data', growthRate: 0 };
  }
  
  const firstMonth = trends[0];
  const lastMonth = trends[trends.length - 1];
  
  const growthRate = firstMonth.monthly_total > 0 ? 
    ((lastMonth.monthly_total - firstMonth.monthly_total) / firstMonth.monthly_total) * 100 : 100;
  
  let trend = 'stable';
  if (growthRate > 20) trend = 'growing';
  else if (growthRate > 10) trend = 'moderate_growth';
  else if (growthRate < -20) trend = 'declining';
  else if (growthRate < -10) trend = 'moderate_decline';
  
  return {
    trend: trend,
    growthRate: Math.round(growthRate),
    monthlyData: trends,
    currentVsPrevious: trends.length > 1 ? 
      ((lastMonth.monthly_total - trends[trends.length - 2].monthly_total) / trends[trends.length - 2].monthly_total) * 100 : 0
  };
}

function generateRetailerInsights(scoreResult, metrics, retailer) {
  const insights = [];
  
  // Volume insights
  if (scoreResult.volumeScore >= 80) {
    insights.push({
      type: 'VOLUME',
      message: `High volume performer with ₹${Math.round(metrics.volume.total_purchase_value || 0).toLocaleString()} in purchases`,
      significance: 'high'
    });
  } else if (scoreResult.volumeScore <= 40) {
    insights.push({
      type: 'VOLUME',
      message: 'Low purchase volume indicates untapped potential',
      significance: 'medium'
    });
  }
  
  // Credit insights
  if (scoreResult.creditRiskScore >= 85) {
    insights.push({
      type: 'CREDIT',
      message: 'Excellent payment behavior with minimal pending invoices',
      significance: 'high'
    });
  } else if (scoreResult.creditRiskScore <= 50) {
    insights.push({
      type: 'CREDIT',
      message: `High credit risk with ₹${Math.round(metrics.credit.total_balance || 0).toLocaleString()} pending`,
      significance: 'high'
    });
  }
  
  // Recency insights
  if (metrics.volume.days_since_last_order > 90) {
    insights.push({
      type: 'RECENCY',
      message: `No purchases in ${metrics.volume.days_since_last_order} days - Risk of attrition`,
      significance: 'high'
    });
  } else if (metrics.volume.days_since_last_order <= 7) {
    insights.push({
      type: 'RECENCY',
      message: 'Recent purchase indicates active engagement',
      significance: 'medium'
    });
  }
  
  // Product mix insights
  if (metrics.product.unique_products >= 10) {
    insights.push({
      type: 'PRODUCT',
      message: `Diverse product mix with ${metrics.product.unique_products} unique products`,
      significance: 'medium'
    });
  }
  
  // Growth insights from trend
  if (metrics.growthTrend && metrics.growthTrend.trend === 'growing') {
    insights.push({
      type: 'GROWTH',
      message: `Strong growth trend of ${metrics.growthTrend.growthRate}%`,
      significance: 'high'
    });
  }
  
  // Staff assignment insights
  if (retailer.assigned_staff) {
    insights.push({
      type: 'STAFF',
      message: `Assigned to staff member: ${retailer.assigned_staff}`,
      significance: 'low'
    });
  }
  
  return insights;
}

function generateActionableRecommendations(scoreResult, metrics) {
  const recommendations = [];
  
  // Credit risk recommendations
  if (scoreResult.creditRiskScore < 60) {
    recommendations.push({
      category: 'CREDIT_MANAGEMENT',
      priority: 'HIGH',
      action: 'Review and potentially reduce credit limit',
      reason: `High credit risk score of ${Math.round(scoreResult.creditRiskScore)}`,
      timeline: 'Immediate'
    });
    
    if (metrics.credit.avg_pending_days > 30) {
      recommendations.push({
        category: 'PAYMENT_COLLECTION',
        priority: 'HIGH',
        action: 'Implement stricter payment follow-up process',
        reason: `Average payment delay of ${Math.round(metrics.credit.avg_pending_days)} days`,
        timeline: 'Within 7 days'
      });
    }
  }
  
  // Volume growth recommendations
  if (scoreResult.volumeScore < 50) {
    recommendations.push({
      category: 'SALES_GROWTH',
      priority: 'MEDIUM',
      action: 'Offer targeted promotions to increase order frequency',
      reason: `Low volume score of ${Math.round(scoreResult.volumeScore)}`,
      timeline: 'Within 30 days'
    });
    
    if (metrics.volume.days_since_last_order > 60) {
      recommendations.push({
        category: 'CUSTOMER_RETENTION',
        priority: 'MEDIUM',
        action: 'Schedule follow-up call with special reactivation offer',
        reason: `No purchases in ${metrics.volume.days_since_last_order} days`,
        timeline: 'Within 14 days'
      });
    }
  }
  
  // Upsell/cross-sell recommendations
  if (scoreResult.volumeScore >= 70 && scoreResult.creditRiskScore >= 70) {
    recommendations.push({
      category: 'RELATIONSHIP_BUILDING',
      priority: 'LOW',
      action: 'Offer premium/loyalty benefits to this high-value retailer',
      reason: 'Strong performance in both volume and credit',
      timeline: 'Within 30 days'
    });
  }
  
  // Product mix recommendations
  if (metrics.product.unique_products < 3 && metrics.volume.total_orders >= 5) {
    recommendations.push({
      category: 'PRODUCT_DIVERSIFICATION',
      priority: 'MEDIUM',
      action: 'Introduce complementary product categories',
      reason: `Limited to ${metrics.product.unique_products} product types`,
      timeline: 'Within 60 days'
    });
  }
  
  return recommendations;
}

// ============================================
// EXPORT FUNCTIONALITY (Optional)
// ============================================

// GET /api/export/volume-credit-scores/csv - Export scores to CSV
router.get('/export/volume-credit-scores/csv', async (req, res) => {
  try {
    // Get all scores
    const allScores = await getAllVolumeCreditScores();
    
    // Create CSV content
    let csvContent = 'Retailer ID,Business Name,Volume Score,Credit Risk Score,Overall Score,Risk Category,Volume Tier,Total Purchases,Order Count,Avg Order Value,Days Since Last Order,Suggested Credit Limit\n';
    
    allScores.forEach(score => {
      csvContent += `"${score.id}","${score.business_name || score.name}",${score.scores.volumeScore},${score.scores.creditRiskScore},${score.scores.overallScore},"${score.scores.riskCategory}","${score.scores.volumeTier}",${score.metrics.totalPurchases},${score.metrics.orderCount},${score.metrics.avgOrderValue},${score.metrics.daysSinceLastOrder || ''},${score.scores.suggestedCreditLimit}\n`;
    });
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=volume-credit-scores.csv');
    
    res.send(csvContent);
    
  } catch (error) {
    console.error('❌ Error exporting CSV:', error);
    res.status(500).json({ error: 'Failed to export CSV' });
  }
});

async function getAllVolumeCreditScores() {
  return new Promise((resolve, reject) => {
    db.query(`
      SELECT 
        a.id,
        a.name,
        a.business_name,
        a.current_score as volume_score,
        a.score_marks as credit_risk_score,
        a.score_details,
        a.last_score_calculated
      FROM accounts a
      WHERE a.role = 'retailer'
        AND a.current_score IS NOT NULL
        AND a.score_marks IS NOT NULL
      ORDER BY a.current_score DESC
    `, (err, results) => {
      if (err) reject(err);
      
      const enhancedResults = results.map(retailer => {
        const volumeScore = retailer.volume_score || 0;
        const creditScore = retailer.credit_risk_score || 0;
        const overallScore = Math.round((volumeScore * 0.7) + (creditScore * 0.3));
        const scoreDetails = retailer.score_details ? JSON.parse(retailer.score_details) : {};
        
        return {
          id: retailer.id,
          name: retailer.name,
          business_name: retailer.business_name,
          scores: {
            volumeScore: Math.round(volumeScore),
            creditRiskScore: Math.round(creditScore),
            overallScore: overallScore,
            riskCategory: determineRiskCategory(creditScore, volumeScore),
            volumeTier: determineVolumeTier(scoreDetails.total_purchases || 0)
          },
          metrics: {
            totalPurchases: scoreDetails.total_purchases || 0,
            orderCount: scoreDetails.order_count || 0,
            avgOrderValue: scoreDetails.avg_order_value || 0,
            daysSinceLastOrder: scoreDetails.days_since_last_order
          }
        };
      });
      
      resolve(enhancedResults);
    });
  });
}

module.exports = router;