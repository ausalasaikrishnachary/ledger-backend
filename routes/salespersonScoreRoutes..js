const express = require("express");
const router = express.Router();
const db = require('../db');
require("dotenv").config();

// ===================================================
// 📌 CALCULATE SALESPERSON TARGET SCORE
// ===================================================
router.post("/calculate-salesperson-scores", async (req, res) => {
  try {
    console.log("🚀 Starting salesperson target score calculation...");
    
    const { period = 30 } = req.body; // Default to last 30 days
    
    // Get current date and calculate start date
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);
    
    console.log(`📅 Calculating scores for period: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Step 1: Get all staff members (salespersons)
    const [salespersons] = await db.promise().query(
      `SELECT id, name, email, staffid, assigned_staff, Target 
       FROM accounts 
       WHERE role = 'staff'`
    );
    
    console.log(`👥 Found ${salespersons.length} staff members (salespersons)`);
    
    // If no staff found with role='staff', try alternative queries
    if (salespersons.length === 0) {
      console.log("⚠️ No staff found with role='staff', trying alternative queries...");
      
      // Try to find salespersons by checking who has assigned retailers
      const [altSalespersons] = await db.promise().query(
        `SELECT DISTINCT 
          a.id, a.name, a.email, a.staffid, a.assigned_staff, a.Target
         FROM accounts a
         WHERE a.id IN (
           SELECT DISTINCT staffid 
           FROM accounts 
           WHERE role = 'retailer' 
           AND staffid IS NOT NULL
         )
         OR a.name IN (
           SELECT DISTINCT assigned_staff 
           FROM accounts 
           WHERE role = 'retailer' 
           AND assigned_staff IS NOT NULL
         )`
      );
      
      if (altSalespersons.length > 0) {
        console.log(`👥 Found ${altSalespersons.length} salespersons via alternative query`);
        salespersons = altSalespersons;
      }
    }
    
    const results = [];
    
    // Step 2: Calculate score for each salesperson
    for (const salesperson of salespersons) {
      try {
        // Get all retailers assigned to this salesperson
        const [retailers] = await db.promise().query(
          `SELECT id, name 
           FROM accounts 
           WHERE role = 'retailer' 
           AND (assigned_staff = ? OR staffid = ?)`,
          [salesperson.name, salesperson.staffid]
        );
        
        console.log(`📊 Salesperson: ${salesperson.name} has ${retailers.length} retailers`);
        
        // Get total orders amount for these retailers in the period
        let totalOrdersAmount = 0;
        
        if (retailers.length > 0) {
          const retailerIds = retailers.map(r => r.id);
          
          const [orders] = await db.promise().query(
            `SELECT SUM(net_payable) as total_amount 
             FROM orders 
             WHERE customer_id IN (?) 
             AND order_status != 'Cancelled'
             AND created_at >= ? 
             AND created_at <= ?`,
            [retailerIds, startDate, endDate]
          );
          
          totalOrdersAmount = orders[0]?.total_amount || 0;
        }
        
        // Calculate achievement percentage
        const target = parseFloat(salesperson.Target) || 100000; // Default target is 100,000
        const achievementPercentage = target > 0 ? (totalOrdersAmount / target) * 100 : 0;
        
        // Calculate score marks (out of 10, as per your example)
        const scoreMarks = (achievementPercentage / 10).toFixed(2);
        
        // Update salesperson record
        await db.promise().query(
          `UPDATE accounts 
           SET current_score = ?, 
               target_achieved = ?, 
               achievement_percentage = ?, 
               score_marks = ?,
               last_target_calculated = NOW()
           WHERE id = ?`,
          [achievementPercentage, totalOrdersAmount, achievementPercentage, scoreMarks, salesperson.id]
        );
        
        results.push({
          salesperson_id: salesperson.id,
          salesperson_name: salesperson.name,
          staffid: salesperson.staffid,
          target: target,
          total_orders_amount: totalOrdersAmount,
          achievement_percentage: parseFloat(achievementPercentage.toFixed(2)),
          score_marks: parseFloat(scoreMarks),
          retailer_count: retailers.length,
          period_days: period,
          role: salesperson.role || 'staff'
        });
        
        console.log(`✅ ${salesperson.name}: Target ₹${target}, Achieved ₹${totalOrdersAmount}, Score: ${achievementPercentage.toFixed(2)}% (${scoreMarks}/10)`);
        
      } catch (error) {
        console.error(`❌ Error calculating score for ${salesperson.name}:`, error.message);
      }
    }
    
    // Send notification email (optional)
    await sendScoreCalculationEmail(results);
    
    console.log("🎉 Salesperson score calculation completed!");
    
    res.json({
      success: true,
      message: `Salesperson target scores calculated successfully for ${results.length} salespersons`,
      period: `${period} days`,
      calculation_date: new Date().toISOString(),
      results: results
    });
    
  } catch (error) {
    console.error("❌ Error in calculate-salesperson-scores:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate salesperson scores",
      details: error.message
    });
  }
});

// ===================================================
// 📌 GET SALESPERSON SCORE REPORT
// ===================================================
router.get("/salesperson-scores", async (req, res) => {
  try {
    const { period = 'all', limit = 100, page = 1 } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = "WHERE role = 'staff'";
    let orderBy = "ORDER BY achievement_percentage DESC";
    
    if (period === 'recent') {
      whereClause += " AND last_target_calculated >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
    }
    
    const [salespersons] = await db.promise().query(
      `SELECT 
        id, name, email, mobile_number, staffid, assigned_staff,
        Target as target,
        current_score,
        target_achieved,
        achievement_percentage,
        score_marks,
        last_target_calculated,
        DATE(last_target_calculated) as last_calculated_date,
        TIMESTAMPDIFF(DAY, last_target_calculated, NOW()) as days_since_last_calc
       FROM accounts 
       ${whereClause}
       ${orderBy}
       LIMIT ? OFFSET ?`,
      [parseInt(limit), parseInt(offset)]
    );
    
    // If no staff found, try alternative
    if (salespersons.length === 0) {
      console.log("⚠️ No staff with scores found, trying alternative query...");
      
      const [altSalespersons] = await db.promise().query(
        `SELECT DISTINCT 
          a.id, a.name, a.email, a.mobile_number, a.staffid, a.assigned_staff,
          a.Target as target,
          a.current_score,
          a.target_achieved,
          a.achievement_percentage,
          a.score_marks,
          a.last_target_calculated,
          DATE(a.last_target_calculated) as last_calculated_date,
          TIMESTAMPDIFF(DAY, a.last_target_calculated, NOW()) as days_since_last_calc,
          (SELECT COUNT(*) FROM accounts r WHERE r.role = 'retailer' AND (r.assigned_staff = a.name OR r.staffid = a.staffid)) as retailer_count
         FROM accounts a
         WHERE a.id IN (
           SELECT DISTINCT staffid 
           FROM accounts 
           WHERE role = 'retailer' 
           AND staffid IS NOT NULL
         )
         OR a.name IN (
           SELECT DISTINCT assigned_staff 
           FROM accounts 
           WHERE role = 'retailer' 
           AND assigned_staff IS NOT NULL
         )
         ${orderBy}
         LIMIT ? OFFSET ?`,
        [parseInt(limit), parseInt(offset)]
      );
      
      res.json({
        success: true,
        data: altSalespersons,
        pagination: {
          total: altSalespersons.length,
          page: parseInt(page),
          limit: parseInt(limit),
          pages: Math.ceil(altSalespersons.length / limit)
        },
        note: "Using alternative query (no role='staff' found)"
      });
      return;
    }
    
    // Get total count
    const [countResult] = await db.promise().query(
      `SELECT COUNT(*) as total FROM accounts WHERE role = 'staff'`
    );
    
    res.json({
      success: true,
      data: salespersons,
      pagination: {
        total: countResult[0].total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(countResult[0].total / limit)
      }
    });
    
  } catch (error) {
    console.error("❌ Error fetching salesperson scores:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch salesperson scores"
    });
  }
});

// ===================================================
// 📌 GET ALL STAFF (SALESPERSONS) WITH RETAILER COUNT
// ===================================================
router.get("/staff/salespersons", async (req, res) => {
  try {
    const [staff] = await db.promise().query(
      `SELECT 
        a.id, a.name, a.email, a.mobile_number, a.staffid, a.assigned_staff,
        a.Target, a.role, a.designation, a.department,
        (SELECT COUNT(*) FROM accounts r WHERE r.role = 'retailer' AND (r.assigned_staff = a.name OR r.staffid = a.staffid)) as retailer_count,
        a.current_score, a.achievement_percentage, a.score_marks,
        a.last_target_calculated
       FROM accounts a
       WHERE a.role = 'staff'
       ORDER BY a.name`
    );
    
    res.json({
      success: true,
      data: staff,
      count: staff.length
    });
    
  } catch (error) {
    console.error("❌ Error fetching staff list:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch staff list"
    });
  }
});

// ===================================================
// 📌 GET INDIVIDUAL SALESPERSON DETAILS WITH RETAILERS
// ===================================================
router.get("/salesperson-scores/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get salesperson details
    const [salesperson] = await db.promise().query(
      `SELECT 
        id, name, email, mobile_number, staffid, assigned_staff,
        Target as target,
        current_score,
        target_achieved,
        achievement_percentage,
        score_marks,
        last_target_calculated,
        role, designation, department
       FROM accounts 
       WHERE id = ?`,
      [id]
    );
    
    if (salesperson.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Salesperson not found"
      });
    }
    
    // Get retailers assigned to this salesperson
    const [retailers] = await db.promise().query(
      `SELECT 
        id, name, email, mobile_number, 
        business_name, status,
        DATE(created_at) as created_date
       FROM accounts 
       WHERE role = 'retailer'
       AND (assigned_staff = ? OR staffid = ?)
       ORDER BY name`,
      [salesperson[0].name, salesperson[0].staffid]
    );
    
    // Get recent orders from these retailers (last 30 days)
    if (retailers.length > 0) {
      const retailerIds = retailers.map(r => r.id);
      
      const [recentOrders] = await db.promise().query(
        `SELECT 
          o.id, o.order_number, o.customer_name,
          o.net_payable, o.order_status, o.created_at,
          DATE(o.created_at) as order_date
         FROM orders o
         WHERE o.customer_id IN (?)
         AND o.order_status != 'Cancelled'
         AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY o.created_at DESC
         LIMIT 50`,
        [retailerIds]
      );
      
      salesperson[0].recent_orders = recentOrders;
      
      // Calculate month-wise performance
      const [monthlyPerformance] = await db.promise().query(
        `SELECT 
          DATE_FORMAT(created_at, '%Y-%m') as month,
          SUM(net_payable) as total_sales,
          COUNT(*) as order_count
         FROM orders 
         WHERE customer_id IN (?)
         AND order_status != 'Cancelled'
         AND created_at >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
         GROUP BY DATE_FORMAT(created_at, '%Y-%m')
         ORDER BY month DESC`,
        [retailerIds]
      );
      
      salesperson[0].monthly_performance = monthlyPerformance;
      
      // Calculate top performing retailers
      const [topRetailers] = await db.promise().query(
        `SELECT 
          a.name as retailer_name,
          SUM(o.net_payable) as total_purchases,
          COUNT(o.id) as order_count
         FROM orders o
         JOIN accounts a ON o.customer_id = a.id
         WHERE o.customer_id IN (?)
         AND o.order_status != 'Cancelled'
         AND o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
         GROUP BY o.customer_id, a.name
         ORDER BY total_purchases DESC
         LIMIT 10`,
        [retailerIds]
      );
      
      salesperson[0].top_retailers = topRetailers;
    }
    
    salesperson[0].retailers = retailers;
    salesperson[0].retailer_count = retailers.length;
    
    res.json({
      success: true,
      data: salesperson[0]
    });
    
  } catch (error) {
    console.error("❌ Error fetching salesperson details:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch salesperson details"
    });
  }
});

// ===================================================
// 📌 MANUALLY UPDATE SALESPERSON TARGET
// ===================================================
router.put("/update-salesperson-target/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { target } = req.body;
    
    if (!target || isNaN(target)) {
      return res.status(400).json({
        success: false,
        error: "Valid target amount is required"
      });
    }
    
    const [result] = await db.promise().query(
      "UPDATE accounts SET Target = ? WHERE id = ?",
      [target, id]
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        error: "Salesperson not found"
      });
    }
    
    res.json({
      success: true,
      message: "Salesperson target updated successfully",
      target: parseFloat(target)
    });
    
  } catch (error) {
    console.error("❌ Error updating salesperson target:", error);
    res.status(500).json({
      success: false,
      error: "Failed to update salesperson target"
    });
  }
});

// ===================================================
// 📌 CALCULATE SCORE FOR SINGLE SALESPERSON
// ===================================================
router.post("/calculate-single-salesperson-score/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { period = 30 } = req.body;
    
    // Get salesperson
    const [salesperson] = await db.promise().query(
      "SELECT id, name, staffid, assigned_staff, Target FROM accounts WHERE id = ? AND role = 'staff'",
      [id]
    );
    
    if (salesperson.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Salesperson not found or not a staff member"
      });
    }
    
    const sp = salesperson[0];
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - period);
    
    // Get retailers assigned to this salesperson
    const [retailers] = await db.promise().query(
      `SELECT id FROM accounts 
       WHERE role = 'retailer'
       AND (assigned_staff = ? OR staffid = ?)`,
      [sp.name, sp.staffid]
    );
    
    let totalOrdersAmount = 0;
    
    if (retailers.length > 0) {
      const retailerIds = retailers.map(r => r.id);
      
      const [orders] = await db.promise().query(
        `SELECT SUM(net_payable) as total_amount 
         FROM orders 
         WHERE customer_id IN (?) 
         AND order_status != 'Cancelled'
         AND created_at >= ? 
         AND created_at <= NOW()`,
        [retailerIds, startDate]
      );
      
      totalOrdersAmount = orders[0]?.total_amount || 0;
    }
    
    // Calculate scores
    const target = parseFloat(sp.Target) || 100000;
    const achievementPercentage = target > 0 ? (totalOrdersAmount / target) * 100 : 0;
    const scoreMarks = (achievementPercentage / 10).toFixed(2);
    
    // Update record
    await db.promise().query(
      `UPDATE accounts 
       SET current_score = ?, 
           target_achieved = ?, 
           achievement_percentage = ?, 
           score_marks = ?,
           last_target_calculated = NOW()
       WHERE id = ?`,
      [achievementPercentage, totalOrdersAmount, achievementPercentage, scoreMarks, id]
    );
    
    const result = {
      salesperson_id: id,
      salesperson_name: sp.name,
      target: target,
      total_orders_amount: totalOrdersAmount,
      achievement_percentage: parseFloat(achievementPercentage.toFixed(2)),
      score_marks: parseFloat(scoreMarks),
      retailer_count: retailers.length,
      period_days: period,
      calculation_date: new Date().toISOString()
    };
    
    res.json({
      success: true,
      message: "Score calculated successfully",
      data: result
    });
    
  } catch (error) {
    console.error("❌ Error calculating single salesperson score:", error);
    res.status(500).json({
      success: false,
      error: "Failed to calculate score"
    });
  }
});

// ===================================================
// 📌 GET SALESPERSON PERFORMANCE SUMMARY
// ===================================================
router.get("/salesperson-performance/summary", async (req, res) => {
  try {
    // Get summary statistics for staff
    const [summary] = await db.promise().query(
      `SELECT 
        COUNT(*) as total_salespersons,
        AVG(achievement_percentage) as avg_achievement,
        MIN(achievement_percentage) as min_achievement,
        MAX(achievement_percentage) as max_achievement,
        SUM(target_achieved) as total_sales,
        AVG(Target) as avg_target,
        SUM(CASE WHEN achievement_percentage >= 100 THEN 1 ELSE 0 END) as target_achieved_count,
        SUM(CASE WHEN achievement_percentage < 50 THEN 1 ELSE 0 END) as under_performing_count
       FROM accounts 
       WHERE role = 'staff'`
    );
    
    // Get top 5 performers
    const [topPerformers] = await db.promise().query(
      `SELECT 
        name, achievement_percentage, score_marks, 
        target_achieved, Target as target
       FROM accounts 
       WHERE role = 'staff'
         AND achievement_percentage > 0
       ORDER BY achievement_percentage DESC
       LIMIT 5`
    );
    
    // Get performance by month
    const [monthlyPerformance] = await db.promise().query(
      `SELECT 
        DATE_FORMAT(last_target_calculated, '%Y-%m') as month,
        AVG(achievement_percentage) as avg_achievement,
        SUM(target_achieved) as total_sales,
        COUNT(*) as salesperson_count
       FROM accounts 
       WHERE role = 'staff'
         AND last_target_calculated >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
       GROUP BY DATE_FORMAT(last_target_calculated, '%Y-%m')
       ORDER BY month DESC`
    );
    
    res.json({
      success: true,
      summary: summary[0],
      top_performers: topPerformers,
      monthly_performance: monthlyPerformance,
      calculation_date: new Date().toISOString()
    });
    
  } catch (error) {
    console.error("❌ Error fetching performance summary:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch performance summary"
    });
  }
});

// ===================================================
// 📌 ASSIGN RETAILERS TO SALESPERSON
// ===================================================
router.post("/assign-retailers", async (req, res) => {
  try {
    const { salesperson_id, retailer_ids } = req.body;
    
    if (!salesperson_id || !retailer_ids || !Array.isArray(retailer_ids)) {
      return res.status(400).json({
        success: false,
        error: "salesperson_id and retailer_ids array are required"
      });
    }
    
    // Get salesperson details
    const [salesperson] = await db.promise().query(
      "SELECT name, staffid FROM accounts WHERE id = ? AND role = 'staff'",
      [salesperson_id]
    );
    
    if (salesperson.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Salesperson not found"
      });
    }
    
    const sp = salesperson[0];
    let updatedCount = 0;
    
    // Update each retailer
    for (const retailerId of retailer_ids) {
      const [result] = await db.promise().query(
        `UPDATE accounts 
         SET assigned_staff = ?, staffid = ?
         WHERE id = ? AND role = 'retailer'`,
        [sp.name, sp.staffid, retailerId]
      );
      
      if (result.affectedRows > 0) {
        updatedCount++;
      }
    }
    
    res.json({
      success: true,
      message: `Assigned ${updatedCount} retailers to ${sp.name}`,
      assigned_count: updatedCount,
      salesperson_name: sp.name
    });
    
  } catch (error) {
    console.error("❌ Error assigning retailers:", error);
    res.status(500).json({
      success: false,
      error: "Failed to assign retailers"
    });
  }
});

// ===================================================
// 📌 GET UNASSIGNED RETAILERS
// ===================================================
router.get("/retailers/unassigned", async (req, res) => {
  try {
    const [retailers] = await db.promise().query(
      `SELECT 
        id, name, email, mobile_number, business_name,
        created_at, status
       FROM accounts 
       WHERE role = 'retailer'
       AND (assigned_staff IS NULL OR assigned_staff = '')
       ORDER BY name`
    );
    
    res.json({
      success: true,
      data: retailers,
      count: retailers.length
    });
    
  } catch (error) {
    console.error("❌ Error fetching unassigned retailers:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch unassigned retailers"
    });
  }
});

// ===================================================
// 📌 HELPER FUNCTION: SEND SCORE CALCULATION EMAIL
// ===================================================
async function sendScoreCalculationEmail(results) {
  try {
    const nodemailer = require('nodemailer');
    
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER || "your-email@gmail.com",
        pass: process.env.EMAIL_PASS || "your-app-password"
      },
      tls: { rejectUnauthorized: false },
    });
    
    if (results.length === 0) {
      console.log("📧 No results to send in email");
      return;
    }
    
    const topPerformers = results
      .sort((a, b) => b.achievement_percentage - a.achievement_percentage)
      .slice(0, 5);
    
    const bottomPerformers = results
      .sort((a, b) => a.achievement_percentage - b.achievement_percentage)
      .slice(0, 5);
    
    const totalAchievement = results.reduce((sum, sp) => sum + sp.achievement_percentage, 0);
    const averageAchievement = results.length > 0 ? totalAchievement / results.length : 0;
    
    const emailHTML = `
      <h2>📊 Salesperson Target Score Report</h2>
      <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
      <p><strong>Total Salespersons (Staff):</strong> ${results.length}</p>
      <p><strong>Average Achievement:</strong> ${averageAchievement.toFixed(2)}%</p>
      
      <h3>🏆 Top Performers:</h3>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
        <tr>
          <th>Rank</th>
          <th>Name</th>
          <th>Target</th>
          <th>Achieved</th>
          <th>Achievement %</th>
          <th>Score</th>
          <th>Retailers</th>
        </tr>
        ${topPerformers.map((sp, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${sp.salesperson_name}</td>
            <td>₹${sp.target.toLocaleString()}</td>
            <td>₹${sp.total_orders_amount.toLocaleString()}</td>
            <td>${sp.achievement_percentage.toFixed(2)}%</td>
            <td>${sp.score_marks}/10</td>
            <td>${sp.retailer_count}</td>
          </tr>
        `).join('')}
      </table>
      
      <h3>📉 Needs Improvement:</h3>
      <table border="1" cellpadding="8" cellspacing="0" style="border-collapse: collapse;">
        <tr>
          <th>Name</th>
          <th>Achievement %</th>
          <th>Score</th>
          <th>Retailers</th>
          <th>Target</th>
        </tr>
        ${bottomPerformers.map(sp => `
          <tr>
            <td>${sp.salesperson_name}</td>
            <td>${sp.achievement_percentage.toFixed(2)}%</td>
            <td>${sp.score_marks}/10</td>
            <td>${sp.retailer_count}</td>
            <td>₹${sp.target.toLocaleString()}</td>
          </tr>
        `).join('')}
      </table>
      
      <p><em>Note: Scores are calculated based on total orders from assigned retailers for staff members.</em></p>
    `;
    
    const mailOptions = {
      from: process.env.EMAIL_USER || "your-email@gmail.com",
      to: process.env.ADMIN_EMAIL || "admin@yourcompany.com",
      subject: `Staff Salesperson Target Score Report - ${new Date().toLocaleDateString()}`,
      html: emailHTML,
    };
    
    await transporter.sendMail(mailOptions);
    console.log("📧 Score calculation email sent to admin");
    
  } catch (error) {
    console.error("❌ Error sending email:", error.message);
    // Don't fail the whole process if email fails
  }
}

module.exports = router;