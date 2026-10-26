# 1. Team Name and Members

**Team Name:** Group 1

**Members:** Azad Jagtap, Jingo Tu, Jingyi Wang, Yufeng Chi

# 2. Project Idea

**RoboPlay** is an interactive, browser-based robotics playground inspired by the MicroDuck simulator. Visitors will guide a robot through a short challenge course and interact with obstacles or objects. A React results screen will show performance based on task completion and elapsed time, while `localStorage` will preserve past results and personal bests. A policy-explorer section will introduce visitors to real robotics policies alongside the challenge. We will focus the initial experience on one robot and one well-designed challenge so that it is engaging and reliable to demo.

# 3. External API and Why

We plan to use the **[Hugging Face Hub API](https://huggingface.co/docs/hub/en/api)** to retrieve information about publicly available robotics policy models, such as model names, authors, update dates, and available policy files. This data will power a React policy-explorer interface where visitors can browse selected models and follow links to their original sources. The Hub API is a natural fit because it connects our interactive challenge to real, openly shared robotics work and can be accessed from the browser without an inference backend.
