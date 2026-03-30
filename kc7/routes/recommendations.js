const express = require('express');
const router  = express.Router();
const { sql, poolPromise } = require('../db');
const { authMiddleware } = require('../middleware/auth');

router.get('/:assessmentId', authMiddleware, async (req, res) => {
    try {
        const pool = await poolPromise;

        // Get results
        const resResult = await pool.request()
            .input('assessmentId', sql.Int, req.params.assessmentId)
            .query('SELECT * FROM assessment_results WHERE assessmentId = @assessmentId');

        if (resResult.recordset.length === 0)
            return res.status(404).json({ error: 'Assessment results not found.' });

        const r = resResult.recordset[0];

        // Check if recommendations already exist
        const existing = await pool.request()
            .input('resultId', sql.Int, r.id)
            .query('SELECT * FROM recommendations WHERE assessmentResultId = @resultId');

        if (existing.recordset.length > 0) {
            return res.json({ success: true, recommendations: existing.recordset });
        }

        // Generate recommendations based on scores
        const recs = [];
        const domains = [
            { key: 'communication', score: r.communicationScore, label: 'Communication' },
            { key: 'social',        score: r.socialScore,        label: 'Social Skills' },
            { key: 'cognitive',     score: r.cognitiveScore,     label: 'Cognitive' },
            { key: 'motor',         score: r.motorScore,         label: 'Motor Skills' },
        ];

        const suggestionMap = {
            communication: {
                high:   { suggestion: 'Continue encouraging verbal communication through storytelling and reading aloud daily.', activities: ['Read together 20 min/day', 'Ask open-ended questions', 'Sing songs and nursery rhymes'] },
                medium: { suggestion: 'Practice conversation skills and expand vocabulary with daily activities.', activities: ['Describe pictures in books', 'Play word games', 'Talk during daily routines'] },
                low:    { suggestion: 'Immediate speech therapy evaluation recommended. Focus on basic communication cues.', activities: ['Consult a speech therapist', 'Use picture cards for communication', 'Practice simple words daily'] }
            },
            social: {
                high:   { suggestion: 'Encourage group play and cooperative activities to further develop social bonds.', activities: ['Arrange playdates', 'Team sports or group classes', 'Board games with family'] },
                medium: { suggestion: 'Increase opportunities for peer interaction in structured settings.', activities: ['Join a playgroup', 'Practice turn-taking games', 'Role-play social scenarios'] },
                low:    { suggestion: 'Consider evaluation for social development support. Structured social programs recommended.', activities: ['Consult a developmental pediatrician', 'Social skills groups', 'Gradual peer exposure'] }
            },
            cognitive: {
                high:   { suggestion: 'Challenge with age-appropriate puzzles and creative problem-solving activities.', activities: ['Puzzles and building blocks', 'Science experiments', 'Memory games'] },
                medium: { suggestion: 'Incorporate more hands-on learning and exploratory play.', activities: ['Sorting and counting games', 'Simple cooking together', 'Nature exploration'] },
                low:    { suggestion: 'Cognitive development evaluation recommended. Focus on foundational learning skills.', activities: ['Consult a developmental specialist', 'Shape and color recognition', 'Simple cause-and-effect toys'] }
            },
            motor: {
                high:   { suggestion: 'Support fine and gross motor development through active play and art.', activities: ['Drawing and coloring', 'Outdoor play', 'Dance and movement activities'] },
                medium: { suggestion: 'Increase physical activities that challenge both fine and gross motor skills.', activities: ['Playdough and clay activities', 'Tricycle or bike riding', 'Climbing structures'] },
                low:    { suggestion: 'Occupational therapy evaluation recommended to address motor skill delays.', activities: ['Consult an occupational therapist', 'Finger strengthening exercises', 'Balance and coordination activities'] }
            }
        };

        for (const d of domains) {
            const priority = d.score >= 70 ? 'low' : d.score >= 40 ? 'medium' : 'high';
            const level    = d.score >= 70 ? 'high' : d.score >= 40 ? 'medium' : 'low';
            const info     = suggestionMap[d.key][level];
            const consultationNeeded = d.score < 40;

            await pool.request()
                .input('resultId',           sql.Int,      r.id)
                .input('childId',            sql.Int,      r.childId)
                .input('skill',              sql.NVarChar, d.key)
                .input('priority',           sql.NVarChar, priority)
                .input('suggestion',         sql.NVarChar, info.suggestion)
                .input('activities',         sql.NVarChar, JSON.stringify(info.activities))
                .input('consultationNeeded', sql.Bit,      consultationNeeded)
                .query(`
                    INSERT INTO recommendations
                        (assessmentResultId, childId, skill, priority, suggestion, activities, consultationNeeded)
                    VALUES
                        (@resultId, @childId, @skill, @priority, @suggestion, @activities, @consultationNeeded)
                `);

            recs.push({ skill: d.key, priority, suggestion: info.suggestion, activities: info.activities, consultationNeeded });
        }

        res.json({ success: true, recommendations: recs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
