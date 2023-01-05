// SPDX-License-Identifier: MIT
pragma solidity 0.8.17;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./BaseStakingPool.sol";

/**
 * @title WeSendit Staking Pool
 */
contract StakingPool is BaseStakingPool {
    constructor(
        address stakeTokenAddress,
        address rewardTokenAddress
    ) BaseStakingPool(stakeTokenAddress, rewardTokenAddress) {}

    function stake(
        uint256 amount,
        uint256 duration,
        bool enableAutoCompounding
    ) public nonReentrant returns (uint256 value) {
        require(
            duration >= minDuration() && duration <= maxDuration(),
            "Staking Pool: Invalid staking duration"
        );

        // TODO: handle missing approve

        require(
            stakeToken().transferFrom(_msgSender(), address(this), amount),
            "Staking Pool: Failed to transfer token"
        );
        _totalTokenLocked += amount;

        // TODO: check duration only weeks

        // Trigger pool update
        updatePool();

        uint256 multiplier;

        // TODO: add check for max. pool allocation
        // TODO: add anti-whale protection
        if (enableAutoCompounding) {
            multiplier = apy(duration, 100 ether);
        } else {
            multiplier = apr(duration, 100 ether);
        }

        // uint256 totalShares = (((amount * multiplier) / 1e5) - amount) / 1e18;

        uint256 totalRewards = ((amount * multiplier) / 1e5) - amount;
        _allocatedPoolRewards += totalRewards;

        // Calculate pool shares for staking entry
        uint256 totalShares = (amount * multiplier) / 1e5 / 1e18;
        _allocatedPoolShares += totalShares;

        // Calculate initial reward debt (see PancakeSwap staking for futher explaination)
        uint256 rewardDebt = totalShares * _accRewardsPerShare;

        // Create pool entry
        PoolEntry memory entry = PoolEntry(
            amount,
            duration,
            totalShares,
            rewardDebt,
            0,
            0,
            block.timestamp,
            block.number,
            enableAutoCompounding
        );

        // Mint reward NFT
        // TODO: add NFT metadata
        uint256 tokenId = rewardToken().mint(_msgSender());
        _poolEntries[tokenId] = entry;

        return tokenId;
    }

    function unstake(
        uint256 tokenId
    ) public onlyTokenOwner(tokenId) nonReentrant {
        PoolEntry memory entry = poolEntry(tokenId);

        // Check for staking lock period
        require(
            entry.startedAt + (entry.duration * SECONDS_PER_DAY) >=
                block.timestamp,
            "Staking Pool: Staking entry is locked"
        );

        // Force rewards payout
        claimRewards(tokenId);

        // Transfer initial stake amount
        require(
            stakeToken().transfer(_msgSender(), entry.amount),
            "Staking Pool: Failed to transfer initial stake"
        );

        _allocatedPoolShares -= entry.shares;

        // TODO: remove from allocated rewards

        _totalTokenLocked -= entry.amount;

        // Trigger pool update
        updatePool();
    }

    function claimRewards(
        uint256 tokenId
    ) public onlyTokenOwner(tokenId) nonReentrant {
        PoolEntry memory entry = poolEntry(tokenId);

        require(
            !entry.isAutoCompoundingEnabled,
            "Staking Pool: Cannot claim rewards if auto-compounding is enabled"
        );

        require(
            block.timestamp >= (entry.lastClaimedAt + (12 * SECONDS_PER_HOUR)),
            "Staking Pool: Already claimed within last 12 hours"
        );

        uint256 rewards = pendingRewards(tokenId);
        require(rewards > 0, "Staking Pool: No rewards available to claim");

        // TODO: remove from allocated rewards

        require(
            stakeToken().transfer(_msgSender(), rewards),
            "Staking Pool: Failed to transfer rewards"
        );

        // TODO: is this working?
        entry.claimedRewards += rewards;
        entry.lastClaimedAt = block.timestamp;
    }

    function pendingRewards(
        uint256 tokenId
    ) public view returns (uint256 value) {
        PoolEntry memory entry = poolEntry(tokenId);

        uint256 rewards;
        if (block.number > lastRewardBlock()) {
            // If lastRewardBlock is in the past, calculate new values here
            rewards = entry.shares * _calculateAccRewardsPerShare();
        } else {
            // If we've just updated, use static values here
            rewards = entry.shares * _accRewardsPerShare;
        }

        uint256 endBlock = entry.startBlock + 10373685;
        if (block.number > endBlock + 1) {
            console.log("Current Rewards: ", rewards);
            console.log("Current Block: ", block.number);
            (
                uint256 accRewardsPerShareId,
                uint256 accRewardsPerShareSnapshot
            ) = _accRewardsPerShareAt(endBlock);
            console.log(
                "accRewardsPerShare snapshot value: ",
                accRewardsPerShareSnapshot,
                " at block: ",
                accRewardsPerShareId
            );

            (, uint256 poolFactorSnapshot) = _poolFactorAt(endBlock);

            uint256 elapsedRewards = _calculateAccRewardsPerShare(
                block.number - endBlock - 1,
                poolFactorSnapshot
            );

            console.log("Elapsed Blocks: ", block.number - endBlock);
            console.log("Elapsed Rewards: ", entry.shares * elapsedRewards);

            rewards -= (entry.shares * elapsedRewards);

            console.log("New Rewards: ", rewards);
        }

        // Subtract reward debt from rewards
        uint256 totalRewards = rewards - entry.rewardDebt;

        // Calculate pool rewards fee
        uint256 fee = (totalRewards * 3) / 100;

        // Return pending rewards without fee and claimed rewards
        return totalRewards - fee - entry.claimedRewards;
    }

    function updatePool() public {
        // We've already updated this block
        if (lastRewardBlock() >= block.number) {
            return;
        }

        // No one is currently staking, skipping update...
        if (allocatedPoolShares() == 0) {
            _lastRewardBlock = block.number;
            return;
        }

        // TODO: no rewards if pool is empty

        // Calculate rewards per share
        _accRewardsPerShare = _calculateAccRewardsPerShare();

        _updateSnapshot(_accRewardsPerShareSnapshots, _accRewardsPerShare);

        // Update pool factor
        _currentPoolFactor = poolFactor(poolBalance());

        _updateSnapshot(_poolFactorSnapshots, _currentPoolFactor);

        _snapshot();

        // Update last reward block
        _lastRewardBlock = block.number;
    }
}
