// const express = require("express");
// const router = express.Router();
// const db = require("../db"); // change path if your db file name is different

// // GET latest company info
// router.get("/company-info", async (req, res) => {
//   try {
//     const [rows] = await db.query(
//       "SELECT * FROM company_info ORDER BY id DESC LIMIT 1"
//     );

//     res.json({
//       success: true,
//       data: rows[0] || null,
//     });
//   } catch (error) {
//     console.error("Fetch company info error:", error);
//     res.status(500).json({
//       success: false,
//       error: "Failed to fetch company info",
//     });
//   }
// });

// // INSERT company info
// router.post("/company-info", async (req, res) => {
//   try {
//     const {
//       company_name,
//       email,
//       phone,
//       gstin,
//       state,
//       state_code,
//       location,
//       address,
//     } = req.body;

//     if (!company_name) {
//       return res.status(400).json({
//         success: false,
//         error: "Company name is required",
//       });
//     }

//     const [result] = await db.query(
//       `INSERT INTO company_info
//       (company_name, email, phone, gstin, state, state_code, location, address)
//       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         company_name,
//         email,
//         phone,
//         gstin,
//         state,
//         state_code,
//         location,
//         address,
//       ]
//     );

//     res.json({
//       success: true,
//       message: "Company info inserted successfully",
//       id: result.insertId,
//     });
//   } catch (error) {
//     console.error("Insert company info error:", error);
//     res.status(500).json({
//       success: false,
//       error: "Failed to insert company info",
//     });
//   }
// });

// // UPDATE company info
// router.put("/company-info/:id", async (req, res) => {
//   try {
//     const { id } = req.params;

//     const {
//       company_name,
//       email,
//       phone,
//       gstin,
//       state,
//       state_code,
//       location,
//       address,
//     } = req.body;

//     await db.query(
//       `UPDATE company_info
//        SET company_name=?, email=?, phone=?, gstin=?, state=?, state_code=?, location=?, address=?
//        WHERE id=?`,
//       [
//         company_name,
//         email,
//         phone,
//         gstin,
//         state,
//         state_code,
//         location,
//         address,
//         id,
//       ]
//     );

//     res.json({
//       success: true,
//       message: "Company info updated successfully",
//     });
//   } catch (error) {
//     console.error("Update company info error:", error);
//     res.status(500).json({
//       success: false,
//       error: "Failed to update company info",
//     });
//   }
// });

// module.exports = router;

const express = require("express");
const router = express.Router();
const db = require("../db");

router.get("/company-info", (req, res) => {
  db.query("SELECT * FROM company_info ORDER BY id DESC LIMIT 1", (err, results) => {
    if (err) {
      return res.status(500).json({ success: false, error: err.message });
    }

    res.json({
      success: true,
      data: results[0] || null,
    });
  });
});

router.post("/company-info", (req, res) => {
  const {
    company_name,
    branch,
    email,
    phone,
    gstin,
    state,
    state_code,
    location,
    address,
  } = req.body;

  db.query(
    `INSERT INTO company_info 
    (company_name, branch, email, phone, gstin, state, state_code, location, address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      company_name,
      branch,
      email,
      phone,
      gstin,
      state,
      state_code,
      location,
      address,
    ],
    (err, result) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }

      res.json({
        success: true,
        message: "Company info saved successfully",
        id: result.insertId,
      });
    }
  );
});

router.put("/company-info/:id", (req, res) => {
  const { id } = req.params;

  const {
    company_name,
    branch,
    email,
    phone,
    gstin,
    state,
    state_code,
    location,
    address,
  } = req.body;

  db.query(
    `UPDATE company_info 
     SET company_name=?, branch=?, email=?, phone=?, gstin=?, state=?, state_code=?, location=?, address=?
     WHERE id=?`,
    [
      company_name,
      branch,
      email,
      phone,
      gstin,
      state,
      state_code,
      location,
      address,
      id,
    ],
    (err) => {
      if (err) {
        return res.status(500).json({ success: false, error: err.message });
      }

      res.json({
        success: true,
        message: "Company info updated successfully",
      });
    }
  );
});

module.exports = router;