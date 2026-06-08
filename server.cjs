const express = require('express');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database tables
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS refugees (
        id SERIAL PRIMARY KEY,
        unhcr_id VARCHAR(20) UNIQUE NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        date_of_birth DATE,
        gender VARCHAR(10),
        nationality VARCHAR(50),
        country_of_origin VARCHAR(50),
        arrival_date DATE NOT NULL,
        arrival_location VARCHAR(100),
        family_size INTEGER DEFAULT 1,
        vulnerability_status VARCHAR(50),
        registration_status VARCHAR(30) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT -- [IGM-GOVERNED] Administrative notes and case updates
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS needs_assessments (
        id SERIAL PRIMARY KEY,
        refugee_id INTEGER REFERENCES refugees(id) ON DELETE CASCADE,
        assessment_date DATE NOT NULL,
        shelter_need VARCHAR(20) DEFAULT 'none',
        food_need VARCHAR(20) DEFAULT 'none',
        medical_need VARCHAR(20) DEFAULT 'none',
        education_need VARCHAR(20) DEFAULT 'none',
        protection_need VARCHAR(20) DEFAULT 'none',
        legal_need VARCHAR(20) DEFAULT 'none',
        psychosocial_need VARCHAR(20) DEFAULT 'none',
        livelihood_need VARCHAR(20) DEFAULT 'none',
        priority_level VARCHAR(10) DEFAULT 'medium',
        assessed_by VARCHAR(100),
        next_assessment_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT -- [IGM-GOVERNED] Assessment findings and recommendations
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS services (
        id SERIAL PRIMARY KEY,
        service_name VARCHAR(100) NOT NULL,
        service_type VARCHAR(50) NOT NULL,
        provider_agency VARCHAR(100),
        description TEXT,
        location VARCHAR(100),
        capacity INTEGER,
        current_beneficiaries INTEGER DEFAULT 0,
        eligibility_criteria TEXT,
        contact_person VARCHAR(100),
        contact_phone VARCHAR(20),
        contact_email VARCHAR(100),
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT -- [IGM-GOVERNED] Service delivery notes and updates
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS service_referrals (
        id SERIAL PRIMARY KEY,
        refugee_id INTEGER REFERENCES refugees(id) ON DELETE CASCADE,
        service_id INTEGER REFERENCES services(id) ON DELETE CASCADE,
        referral_date DATE NOT NULL,
        referred_by VARCHAR(100),
        referral_reason TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        appointment_date DATE,
        completion_date DATE,
        outcome VARCHAR(50),
        follow_up_required BOOLEAN DEFAULT false,
        follow_up_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT -- [IGM-GOVERNED] Referral tracking and outcome notes
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS durable_solutions (
        id SERIAL PRIMARY KEY,
        refugee_id INTEGER REFERENCES refugees(id) ON DELETE CASCADE,
        solution_type VARCHAR(30) NOT NULL,
        application_date DATE,
        status VARCHAR(30) DEFAULT 'under_review',
        target_country VARCHAR(50),
        target_location VARCHAR(100),
        sponsor_information TEXT,
        documentation_status VARCHAR(30),
        interview_date DATE,
        decision_date DATE,
        decision_outcome VARCHAR(20),
        departure_date DATE,
        case_officer VARCHAR(100),
        priority_level VARCHAR(10) DEFAULT 'normal',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT -- [IGM-GOVERNED] Case processing notes and decision rationale
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS family_members (
        id SERIAL PRIMARY KEY,
        primary_refugee_id INTEGER REFERENCES refugees(id) ON DELETE CASCADE,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        relationship VARCHAR(30) NOT NULL,
        date_of_birth DATE,
        gender VARCHAR(10),
        unhcr_id VARCHAR(20),
        special_needs TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT -- [IGM-GOVERNED] Family member specific information
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        organization VARCHAR(100),
        subject VARCHAR(200),
        message TEXT NOT NULL,
        priority VARCHAR(10) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'new',
        assigned_to VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        notes TEXT -- [IGM-GOVERNED] Contact follow-up and resolution notes
      );
    `);

    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}

// Initialize database on startup
initializeDatabase();

// Routes

// Refugees CRUD operations
app.get('/api/refugees', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, nationality, vulnerability } = req.query;
    const offset = (page - 1) * limit;
    
    let query = 'SELECT * FROM refugees WHERE 1=1';
    let params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      query += ` AND registration_status = $${paramCount}`;
      params.push(status);
    }

    if (nationality) {
      paramCount++;
      query += ` AND nationality = $${paramCount}`;
      params.push(nationality);
    }

    if (vulnerability) {
      paramCount++;
      query += ` AND vulnerability_status = $${paramCount}`;
      params.push(vulnerability);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);
    
    // Get total count for pagination
    const countQuery = 'SELECT COUNT(*) FROM refugees WHERE 1=1' + 
      (status ? ' AND registration_status = $1' : '') +
      (nationality ? ` AND nationality = $${status ? 2 : 1}` : '') +
      (vulnerability ? ` AND vulnerability_status = $${[status, nationality].filter(Boolean).length + 1}` : '');
    
    const countParams = [status, nationality, vulnerability].filter(Boolean);
    const countResult = await pool.query(countQuery, countParams);
    
    res.json({
      refugees: result.rows,
      total: parseInt(countResult.rows[0].count),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('Error fetching refugees:', error);
    res.status(500).json({ error: 'Failed to fetch refugees' });
  }
});

app.get('/api/refugees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const refugee = await pool.query('SELECT * FROM refugees WHERE id = $1', [id]);
    
    if (refugee.rows.length === 0) {
      return res.status(404).json({ error: 'Refugee not found' });
    }

    // Get family members
    const familyMembers = await pool.query(
      'SELECT * FROM family_members WHERE primary_refugee_id = $1', [id]
    );

    // Get latest needs assessment
    const assessment = await pool.query(
      'SELECT * FROM needs_assessments WHERE refugee_id = $1 ORDER BY assessment_date DESC LIMIT 1', [id]
    );

    // Get active referrals
    const referrals = await pool.query(`
      SELECT sr.*, s.service_name, s.service_type, s.provider_agency 
      FROM service_referrals sr 
      JOIN services s ON sr.service_id = s.id 
      WHERE sr.refugee_id = $1 
      ORDER BY sr.referral_date DESC
    `, [id]);

    // Get durable solutions
    const solutions = await pool.query(
      'SELECT * FROM durable_solutions WHERE refugee_id = $1 ORDER BY application_date DESC', [id]
    );

    res.json({
      ...refugee.rows[0],
      family_members: familyMembers.rows,
      latest_assessment: assessment.rows[0] || null,
      referrals: referrals.rows,
      durable_solutions: solutions.rows
    });
  } catch (error) {
    console.error('Error fetching refugee details:', error);
    res.status(500).json({ error: 'Failed to fetch refugee details' });
  }
});

app.post('/api/refugees', async (req, res) => {
  try {
    const {
      unhcr_id, first_name, last_name, date_of_birth, gender,
      nationality, country_of_origin, arrival_date, arrival_location,
      family_size, vulnerability_status, notes
    } = req.body;

    const result = await pool.query(`
      INSERT INTO refugees (
        unhcr_id, first_name, last_name, date_of_birth, gender,
        nationality, country_of_origin, arrival_date, arrival_location,
        family_size, vulnerability_status, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *
    `, [
      unhcr_id, first_name, last_name, date_of_birth, gender,
      nationality, country_of_origin, arrival_date, arrival_location,
      family_size, vulnerability_status, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating refugee record:', error);
    if (error.constraint === 'refugees_unhcr_id_key') {
      res.status(400).json({ error: 'UNHCR ID already exists' });
    } else {
      res.status(500).json({ error: 'Failed to create refugee record' });
    }
  }
});

app.put('/api/refugees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      first_name, last_name, date_of_birth, gender, nationality,
      country_of_origin, family_size, vulnerability_status,
      registration_status, notes
    } = req.body;

    const result = await pool.query(`
      UPDATE refugees SET
        first_name = $1, last_name = $2, date_of_birth = $3, gender = $4,
        nationality = $5, country_of_origin = $6, family_size = $7,
        vulnerability_status = $8, registration_status = $9, notes = $10,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING *
    `, [
      first_name, last_name, date_of_birth, gender, nationality,
      country_of_origin, family_size, vulnerability_status,
      registration_status, notes, id
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Refugee not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating refugee:', error);
    res.status(500).json({ error: 'Failed to update refugee record' });
  }
});

app.delete('/api/refugees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM refugees WHERE id = $1 RETURNING id', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Refugee not found' });
    }

    res.json({ message: 'Refugee record deleted successfully' });
  } catch (error) {
    console.error('Error deleting refugee:', error);
    res.status(500).json({ error: 'Failed to delete refugee record' });
  }
});

// Needs Assessments CRUD
app.get('/api/needs-assessments', async (req, res) => {
  try {
    const { refugee_id } = req.query;
    let query = `
      SELECT na.*, r.first_name, r.last_name, r.unhcr_id
      FROM needs_assessments na
      JOIN refugees r ON na.refugee_id = r.id
    `;
    let params = [];

    if (refugee_id) {
      query += ' WHERE na.refugee_id = $1';
      params.push(refugee_id);
    }

    query += ' ORDER BY na.assessment_date DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching assessments:', error);
    res.status(500).json({ error: 'Failed to fetch assessments' });
  }
});

app.post('/api/needs-assessments', async (req, res) => {
  try {
    const {
      refugee_id, assessment_date, shelter_need, food_need, medical_need,
      education_need, protection_need, legal_need, psychosocial_need,
      livelihood_need, priority_level, assessed_by, next_assessment_date, notes
    } = req.body;

    const result = await pool.query(`
      INSERT INTO needs_assessments (
        refugee_id, assessment_date, shelter_need, food_need, medical_need,
        education_need, protection_need, legal_need, psychosocial_need,
        livelihood_need, priority_level, assessed_by, next_assessment_date, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      refugee_id, assessment_date, shelter_need, food_need, medical_need,
      education_need, protection_need, legal_need, psychosocial_need,
      livelihood_need, priority_level, assessed_by, next_assessment_date, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating assessment:', error);
    res.status(500).json({ error: 'Failed to create assessment' });
  }
});

// Services CRUD
app.get('/api/services', async (req, res) => {
  try {
    const { type, active = 'true' } = req.query;
    let query = 'SELECT * FROM services WHERE active = $1';
    let params = [active === 'true'];

    if (type) {
      query += ' AND service_type = $2';
      params.push(type);
    }

    query += ' ORDER BY service_name';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

app.post('/api/services', async (req, res) => {
  try {
    const {
      service_name, service_type, provider_agency, description,
      location, capacity, eligibility_criteria, contact_person,
      contact_phone, contact_email, notes
    } = req.body;

    const result = await pool.query(`
      INSERT INTO services (
        service_name, service_type, provider_agency, description,
        location, capacity, eligibility_criteria, contact_person,
        contact_phone, contact_email, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      service_name, service_type, provider_agency, description,
      location, capacity, eligibility_criteria, contact_person,
      contact_phone, contact_email, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating service:', error);
    res.status(500).json({ error: 'Failed to create service' });
  }
});

// Service Referrals CRUD
app.get('/api/referrals', async (req, res) => {
  try {
    const { refugee_id, status } = req.query;
    let query = `
      SELECT sr.*, s.service_name, s.service_type, s.provider_agency,
             r.first_name, r.last_name, r.unhcr_id
      FROM service_referrals sr
      JOIN services s ON sr.service_id = s.id
      JOIN refugees r ON sr.refugee_id = r.id
      WHERE 1=1
    `;
    let params = [];
    let paramCount = 0;

    if (refugee_id) {
      paramCount++;
      query += ` AND sr.refugee_id = $${paramCount}`;
      params.push(refugee_id);
    }

    if (status) {
      paramCount++;
      query += ` AND sr.status = $${paramCount}`;
      params.push(status);
    }

    query += ' ORDER BY sr.referral_date DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching referrals:', error);
    res.status(500).json({ error: 'Failed to fetch referrals' });
  }
});

app.post('/api/referrals', async (req, res) => {
  try {
    const {
      refugee_id, service_id, referral_date, referred_by,
      referral_reason, appointment_date, notes
    } = req.body;

    const result = await pool.query(`
      INSERT INTO service_referrals (
        refugee_id, service_id, referral_date, referred_by,
        referral_reason, appointment_date, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [refugee_id, service_id, referral_date, referred_by, referral_reason, appointment_date, notes]);

    // Update service beneficiary count
    await pool.query(
      'UPDATE services SET current_beneficiaries = current_beneficiaries + 1 WHERE id = $1',
      [service_id]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating referral:', error);
    res.status(500).json({ error: 'Failed to create referral' });
  }
});

app.put('/api/referrals/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      status, completion_date, outcome, follow_up_required,
      follow_up_date, notes
    } = req.body;

    const result = await pool.query(`
      UPDATE service_referrals SET
        status = $1, completion_date = $2, outcome = $3,
        follow_up_required = $4, follow_up_date = $5, notes = $6
      WHERE id = $7
      RETURNING *
    `, [status, completion_date, outcome, follow_up_required, follow_up_date, notes, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Referral not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating referral:', error);
    res.status(500).json({ error: 'Failed to update referral' });
  }
});

// Durable Solutions CRUD
app.get('/api/durable-solutions', async (req, res) => {
  try {
    const { refugee_id, solution_type, status } = req.query;
    let query = `
      SELECT ds.*, r.first_name, r.last_name, r.unhcr_id
      FROM durable_solutions ds
      JOIN refugees r ON ds.refugee_id = r.id
      WHERE 1=1
    `;
    let params = [];
    let paramCount = 0;

    if (refugee_id) {
      paramCount++;
      query += ` AND ds.refugee_id = $${paramCount}`;
      params.push(refugee_id);
    }

    if (solution_type) {
      paramCount++;
      query += ` AND ds.solution_type = $${paramCount}`;
      params.push(solution_type);
    }

    if (status) {
      paramCount++;
      query += ` AND ds.status = $${paramCount}`;
      params.push(status);
    }

    query += ' ORDER BY ds.application_date DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching durable solutions:', error);
    res.status(500).json({ error: 'Failed to fetch durable solutions' });
  }
});

app.post('/api/durable-solutions', async (req, res) => {
  try {
    const {
      refugee_id, solution_type, application_date, target_country,
      target_location, sponsor_information, case_officer, priority_level, notes
    } = req.body;

    const result = await pool.query(`
      INSERT INTO durable_solutions (
        refugee_id, solution_type, application_date, target_country,
        target_location, sponsor_information, case_officer, priority_level, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      refugee_id, solution_type, application_date, target_country,
      target_location, sponsor_information, case_officer, priority_level, notes
    ]);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating durable solution:', error);
    res.status(500).json({ error: 'Failed to create durable solution' });
  }
});

app.put('/api/durable-solutions/:id', async (req, res) => {
  try {
    const {