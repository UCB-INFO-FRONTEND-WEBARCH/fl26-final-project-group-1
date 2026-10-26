# 1. Team Name and Members

**Team Name:** Group 1

**Members:** Azad Jagtap, Jingo Tu, Jingyi Wang, Yufeng Chi

# 2. Project Idea

**RoboPlay** is an interactive, browser-based robotics playground that helps users experience how a learned robot-control policy works. Inspired by the MicroDuck simulator, the website will place a simulated robot in an engaging 3D environment where visitors can issue movement commands, navigate a short challenge course, and interact with obstacles or objects. At the end of each session, a React results screen will score performance based on task completion, elapsed time, and falls or collisions, while `localStorage` will preserve past results and personal bests. A separate interactive **How It Works** page will explain the feedback loop between sensor observations, a reinforcement-learning policy, robot actions, and the physics simulator. To keep the project feasible, we will initially focus on one robot and one well-designed challenge, with additional scenes as optional extensions.

# 3. External API and Why

We plan to use the **[Hugging Face Hub API](https://huggingface.co/docs/hub/en/api)** to retrieve information about publicly available robotics policies, including model names, descriptions, authors, and downloadable model artifacts. This data will power a React policy-explorer interface where visitors can learn about and compare selected policies. Where supported, we will load curated ONNX policies that match the simulated robot's observation and action interfaces and run them locally in the browser. The Hub API is a natural fit for an educational robotics showcase because it connects the experience to real, openly shared machine-learning models without requiring us to build an inference backend.
